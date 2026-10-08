import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import {
  createAgendaOccurrence,
  patchAgendaOccurrence,
  publishAgenda,
} from "../functions/_lib/services/event-agenda/mutations";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";
import {
  agendaContentPlacementResponseSchema,
  agendaContentSchema,
} from "../assets/shared/schemas/event-agenda-content";
import { agendaImportResponseSchema } from "../assets/shared/schemas/event-agenda";
import { individualAppearanceFixture } from "./helpers/agenda-appearances";

beforeEach(resetDb);
describe("authenticated public agenda preview", () => {
  it.each(["standalone", "legacy", "copied_content"] as const)(
    "refuses %s speaker publication without approval and accepts an explicit individual credit",
    async (source) => {
      const { eventId } = await seedEventAndAdmin(env.DB);
      const admin = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{
        id: string;
      }>())!;
      const token = await createAdminSession(env.DB, admin.id, `approval-${source}`);
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      const post = (path: string, body: unknown, method = "POST") =>
        callApi(env, `/api/v1/events/pqc-2026/agenda${path}`, { method, headers, body: JSON.stringify(body) });
      const fields = {
        title: "Speaker credit needs explicit review",
        speakerUserIds: [admin.id],
        speakerRoles: { [admin.id]: "moderator" },
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
      };
      let agenda;
      if (source === "standalone") {
        const response = await post("/occurrences", { ...fields, expectedRevision: 0 });
        expect(response.status, await response.clone().text()).toBe(200);
        agenda = agendaSnapshotSchema.parse(await response.json());
      } else if (source === "legacy") {
        const response = await post("/imports", {
          expectedRevision: 0,
          source: "legacy",
          dryRun: false,
          occurrences: [{ ...fields, sourceKey: "legacy:unverified-speaker" }],
        });
        expect(response.status, await response.clone().text()).toBe(200);
        agenda = agendaImportResponseSchema.parse(await response.json()).agenda;
      } else {
        const contentResponse = await post("/contents", { expectedRevision: 0, content: fields });
        expect(contentResponse.status, await contentResponse.clone().text()).toBe(200);
        const content = agendaContentSchema.parse(await contentResponse.json());
        const placementResponse = await post(`/contents/${content.id}/placements`, {
          expectedRevision: 1,
          copyAsNew: true,
        });
        expect(placementResponse.status, await placementResponse.clone().text()).toBe(200);
        const placement = agendaContentPlacementResponseSchema.parse(await placementResponse.json());
        const scheduled = await post(
          `/occurrences/${placement.occurrenceId}`,
          {
            expectedRevision: placement.agenda.revision,
            startAt: fields.startAt,
            endAt: fields.endAt,
            visibility: "public",
          },
          "PATCH",
        );
        expect(scheduled.status, await scheduled.clone().text()).toBe(200);
        agenda = agendaSnapshotSchema.parse(await scheduled.json());
      }
      const occurrence = agenda.occurrences[0];
      expect(occurrence.speakers[0].role).toBe("moderator");
      const audits = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count");
      const refused = await post("/publications", { expectedRevision: agenda.revision });
      expect(refused.status).toBe(422);
      expect(await refused.json()).toMatchObject({ error: { code: "AGENDA_REPRESENTATION_REVIEW_REQUIRED" } });
      expect(
        await env.DB.prepare("SELECT revision,published_revision FROM event_agenda_state WHERE event_id=?")
          .bind(eventId)
          .first(),
      ).toEqual({ revision: agenda.revision, published_revision: null });
      expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count")).toBe(audits);
      expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_publications").first("count")).toBe(0);
      const approvedAppearance = individualAppearanceFixture({
        userId: admin.id,
        displayName: "Verified individual moderator",
        approvedAt: "2026-10-04T10:00:00.000Z",
      });
      const saved = await post(`/occurrences/${occurrence.id}/history`, {
        expectedRevision: agenda.revision,
        history: sessionHistoryMetadataSchema.parse({ ...occurrence.history, appearances: [approvedAppearance] }),
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
      const reviewed = agendaSnapshotSchema.parse(await saved.json());
      const published = await post("/publications", { expectedRevision: reviewed.revision });
      expect(published.status, await published.clone().text()).toBe(200);
      expect(agendaSnapshotSchema.parse(await published.json()).occurrences[0].history?.appearances[0]).toEqual(
        approvedAppearance,
      );
    },
  );

  it.each(["source_only_credit", "title_not_recorded", "credit_not_recorded"] as const)(
    "retains %s evidence in a draft and refuses publication atomically",
    async (missing) => {
      const { eventId } = await seedEventAndAdmin(env.DB);
      const admin = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{
        id: string;
      }>())!;
      await env.DB.prepare("UPDATE events SET starts_at=NULL,ends_at=NULL WHERE id=?").bind(eventId).run();
      const initial = await createAgendaOccurrence(
        env.DB,
        eventId,
        "pqc-2026",
        agendaOccurrenceCreateSchema.parse({
          expectedRevision: 0,
          title: missing === "title_not_recorded" ? "Title not recorded" : "Historical source",
          startAt: "2023-11-07T09:00:00.000Z",
          endAt: "2023-11-07T09:30:00.000Z",
          roomId: null,
        }),
      );
      const sourcePath = "content/events/historical/index.md",
        sourceDigest = "a".repeat(64),
        reviewedAt = "2026-10-04T10:00:00.000Z";
      const history = sessionHistoryMetadataSchema.parse(
        missing === "source_only_credit"
          ? {
              archivalCredits: [
                {
                  sourceRef: "authored-speaker",
                  role: "speaker",
                  sourcePath,
                  sourceDigest,
                  provenance: "authored_public",
                  displayName: "Exact authored name",
                  organizationName: null,
                  jobTitle: "Exact authored job title",
                  biography: "Original authored biography",
                  photoUrl: null,
                },
              ],
            }
          : {
              sourceDecisions: [
                {
                  kind: missing === "title_not_recorded" ? "title" : "credit",
                  sourcePath,
                  sourceDigest,
                  sourceLocator: "2023-11-07:0:0",
                  authoredValue: missing === "title_not_recorded" ? null : "None",
                  decision: missing,
                  resolvedValue: missing === "title_not_recorded" ? "Title not recorded" : null,
                  reviewedAt,
                },
              ],
            },
      );
      await env.DB.prepare(
        "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
      )
        .bind(initial.occurrences[0].id, JSON.stringify(history), admin.id, reviewedAt)
        .run();
      const before = await env.DB.prepare(
        "SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?",
      )
        .bind(initial.occurrences[0].id)
        .first("metadata_json");
      const audits = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count");
      const token = await createAdminSession(env.DB, admin.id, `missing-${missing}`);
      if (missing === "source_only_credit") {
        for (const archivalCredits of [[], [{ ...history.archivalCredits[0], displayName: "Forged source name" }]]) {
          const tampered = await callApi(
            env,
            `/api/v1/events/pqc-2026/agenda/occurrences/${initial.occurrences[0].id}/history`,
            {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ expectedRevision: initial.revision, history: { ...history, archivalCredits } }),
            },
          );
          expect(tampered.status).toBe(400);
          expect(await tampered.json()).toMatchObject({ error: { code: "ARCHIVAL_CREDIT_PROVENANCE_IMMUTABLE" } });
        }
      }
      const refused = await callApi(env, "/api/v1/events/pqc-2026/agenda/publications", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: initial.revision }),
      });
      expect(refused.status).toBe(422);
      expect(await refused.json()).toMatchObject({ error: { code: "AGENDA_HISTORICAL_MAPPING_REQUIRED" } });
      expect(
        await env.DB.prepare("SELECT revision,published_revision FROM event_agenda_state WHERE event_id=?")
          .bind(eventId)
          .first(),
      ).toEqual({ revision: initial.revision, published_revision: null });
      expect(
        await env.DB.prepare("SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?")
          .bind(initial.occurrences[0].id)
          .first("metadata_json"),
      ).toBe(before);
      expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count")).toBe(audits);
      expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_publications").first("count")).toBe(0);
    },
  );

  it("hides private and unscheduled content without approving the draft, and requires authentication", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(eventId).run();
    const admin = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!;
    let revision = 0;
    let publicOccurrenceId = "";
    for (const [title, visibility, scheduled] of [
      ["Public session", "public", true],
      ["Private session", "private", true],
      ["Unscheduled", "public", false],
    ] as const) {
      const result = await createAgendaOccurrence(
        env.DB,
        eventId,
        "pqc-2026",
        agendaOccurrenceCreateSchema.parse({
          expectedRevision: revision,
          title,
          visibility,
          roomId: null,
          startAt: scheduled ? "2026-12-01T09:00:00.000Z" : null,
          endAt: scheduled ? "2026-12-01T10:00:00.000Z" : null,
          speakerUserIds: title === "Public session" ? [admin.id] : [],
        }),
      );
      revision = result.revision;
      if (title === "Public session") publicOccurrenceId = result.occurrences[0]!.id;
    }
    const history = sessionHistoryMetadataSchema.parse({
      proposalRepresentations: [
        {
          userId: admin.id,
          actingIdentityId: null,
          selectedAt: "2026-10-03T00:00:00.000Z",
          snapshot: {
            organizationName: null,
            jobTitle: null,
            biography: "Private pending representation",
            links: [],
          },
        },
      ],
      sourceDecisions: [
        {
          kind: "title",
          sourcePath: "content/events/synthetic-source/index.md",
          sourceDigest: "a".repeat(64),
          sourceLocator: "private-review-locator",
          authoredValue: "",
          decision: "reviewed_title",
          resolvedValue: "Public session",
          reviewedAt: "2026-10-03T00:00:00.000Z",
        },
      ],
    });
    await env.DB.prepare(
      "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
    )
      .bind(publicOccurrenceId, JSON.stringify(history), admin.id, "2026-10-03T00:00:00.000Z")
      .run();
    const path = "/api/v1/events/pqc-2026/agenda/previews";
    expect((await callApi(env, path)).status).toBe(401);
    const token = await createAdminSession(env.DB, admin.id, "agenda-preview");
    const headers = { authorization: `Bearer ${token}` };
    const response = await callApi(env, path, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const publicPayload = await response.text();
    expect(publicPayload).not.toContain("Private pending representation");
    expect(publicPayload).not.toContain("private-review-locator");
    const preview = agendaSnapshotSchema.parse(JSON.parse(publicPayload));
    expect(preview.occurrences[0]!.history).toMatchObject({ proposalRepresentations: [], sourceDecisions: [] });
    expect(preview.occurrences.map((row) => row.title)).toEqual(["Public session"]);
    expect(preview).toMatchObject({
      revision,
      publishedRevision: null,
      shifts: [],
      assignments: [],
      roleMembers: [],
      staffingPositions: [],
    });
    expect(preview.approvedAt).toBeUndefined();
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_publications WHERE event_id=?")
        .bind(eventId)
        .first<{ count: number }>())!.count,
    ).toBe(0);
    expect((await callApi(env, `${path}?revision=approved`, { headers })).status).toBe(404);
    expect((await callApi(env, `${path}?revision=invalid`, { headers })).status).toBe(400);
    const refused = await callApi(env, "/api/v1/events/pqc-2026/agenda/publications", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision }),
    });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "AGENDA_REPRESENTATION_REVIEW_REQUIRED" } });
    // A previously imported proposal may predate the source suggestion metadata.
    await env.DB.prepare("UPDATE event_agenda_session_history SET metadata_json=? WHERE occurrence_id=?")
      .bind(JSON.stringify({ ...history, proposalRepresentations: [] }), publicOccurrenceId)
      .run();
    await env.DB.prepare("UPDATE event_agenda_occurrences SET source_key=? WHERE id=?")
      .bind("proposal:legacy-import", publicOccurrenceId)
      .run();
    const legacyRefused = await callApi(env, "/api/v1/events/pqc-2026/agenda/publications", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision }),
    });
    expect(legacyRefused.status).toBe(422);
    expect(await legacyRefused.json()).toMatchObject({ error: { code: "AGENDA_REPRESENTATION_REVIEW_REQUIRED" } });
    expect(
      await env.DB.prepare("SELECT revision,published_revision FROM event_agenda_state WHERE event_id=?")
        .bind(eventId)
        .first(),
    ).toEqual({ revision, published_revision: null });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_publications WHERE event_id=?")
        .bind(eventId)
        .first<{ count: number }>())!.count,
    ).toBe(0);
  });

  it("renders the frozen approved revision exactly as static extraction while the draft advances", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(eventId).run();
    const admin = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!;
    const initial = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Approved title",
        roomId: null,
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
      }),
    );
    const approved = await publishAgenda(env.DB, eventId, "pqc-2026", initial.revision, admin.id);
    await patchAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      initial.occurrences[0]!.id,
      agendaOccurrencePatchSchema.parse({ expectedRevision: approved.revision, title: "Draft title" }),
    );
    const token = await createAdminSession(env.DB, admin.id, "agenda-frozen-preview");
    const headers = { authorization: `Bearer ${token}` };
    const response = await callApi(env, "/api/v1/events/pqc-2026/agenda/previews?revision=approved", { headers });
    expect(response.status).toBe(200);
    const preview = agendaSnapshotSchema.parse(await response.json());
    const publication = await readSitePublicationSnapshot(env.DB, []);
    expect(preview).toEqual(publication.eventAgendas?.["pqc-2026"]);
    expect(preview.occurrences[0]!.title).toBe("Approved title");
    const draftResponse = await callApi(env, "/api/v1/events/pqc-2026/agenda/previews?revision=draft", { headers });
    const draft = agendaSnapshotSchema.parse(await draftResponse.json());
    expect(draft.occurrences[0]!.title).toBe("Draft title");
    expect(draft.approvedAt).toBeUndefined();
    expect(draft.publishedRevision).toBe(approved.revision);
  });
});
