import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { agendaImportResponseSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { agendaContentsResponseSchema } from "../assets/shared/schemas/event-agenda-content";
import {
  sessionAppearanceChoicesSchema,
  sessionHistoryMetadataSchema,
} from "../assets/shared/schemas/event-session-history";

let eventId = "",
  actor = "",
  token = "",
  roomId = "";
const startAt = "2026-12-01T10:00:00.000Z",
  endAt = "2026-12-01T11:00:00.000Z";
const selectedAt = "2026-10-03T10:00:00.000Z";
const affiliation = {
  organizationName: "Selected organization",
  jobTitle: "Selected role",
  biography: "Selected biography",
  links: [],
};

function request(path: string, body: unknown, method = "POST") {
  return callApi(env, `/api/v1/events/pqc-2026/agenda${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function fixture(selection: "identity" | "individual" | "unrecorded" = "identity") {
  const organizationId = await insertOrganization(env.DB, affiliation.organizationName);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId);
  const identityId = await addRepresentative(env.DB, memberId, actor, { jobTitle: affiliation.jobTitle });
  await env.DB.prepare(
    "UPDATE identities SET invited_at='2026-01-01T00:00:00.000Z',started_at='2026-01-01T00:00:00.000Z',biography=? WHERE id=?",
  )
    .bind(affiliation.biography, identityId)
    .run();
  const proposalId = crypto.randomUUID(),
    speakerId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO session_proposals(id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at) VALUES(?,?,?,'accepted','talk','Selected representation','Abstract',?,?,?)",
  )
    .bind(proposalId, eventId, actor, crypto.randomUUID(), selectedAt, selectedAt)
    .run();
  await env.DB.prepare(
    "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at,acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json) VALUES(?,?,?,'moderator','confirmed',?,?,?,?)",
  )
    .bind(
      speakerId,
      proposalId,
      actor,
      selectedAt,
      selection === "identity" ? identityId : null,
      selection === "unrecorded" ? null : selectedAt,
      selection === "unrecorded"
        ? null
        : JSON.stringify(
            selection === "identity" ? affiliation : { ...affiliation, organizationName: null, jobTitle: null },
          ),
    )
    .run();
  return { proposalId, speakerId, identityId, organizationId };
}
async function imported(proposalId: string, expectedRevision = 0, place = false) {
  if (place) expectedRevision = await ensureRoom(expectedRevision);
  const body = {
    expectedRevision,
    source: "accepted_proposals",
    proposalIds: [proposalId],
    dryRun: false,
    ...(place ? { proposalPlacement: { proposalId, startAt, endAt, roomId } } : {}),
  };
  const preview = await request("/imports", { ...body, dryRun: true });
  expect(preview.status, await preview.clone().text()).toBe(200);
  const review = agendaImportResponseSchema.parse(await preview.json());
  const response = await request("/imports", {
    ...body,
    ...(place ? { expectedPlacementFingerprint: review.placementFingerprint } : {}),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return agendaImportResponseSchema.parse(await response.json());
}
async function ensureRoom(expectedRevision: number) {
  if (roomId) return expectedRevision;
  const response = await request("/rooms", {
    expectedRevision,
    name: "Canonical test room",
    capacity: 40,
    setupMinutes: 0,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const agenda = agendaSnapshotSchema.parse(await response.json());
  roomId = agenda.rooms[0].id;
  return agenda.revision;
}
beforeEach(async () => {
  await resetDb();
  roomId = "";
  ({ eventId } = await seedEventAndAdmin(env.DB));
  actor = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
  token = await createAdminSession(env.DB, actor, "proposal-identity-import");
  await env.DB.prepare(
    "UPDATE users SET first_name='Original',last_name='Speaker',organization_name='Account employer',job_title='Account role' WHERE id=?",
  )
    .bind(actor)
    .run();
});

describe("accepted proposal representation import", () => {
  it.each(["identity", "individual", "unrecorded"] as const)(
    "keeps %s provenance distinct without approving or inferring affiliation",
    async (selection) => {
      const source = await fixture(selection);
      const result = await imported(source.proposalId, 0, true);
      const occurrence = result.agenda.occurrences[0];
      expect(occurrence.speakers).toMatchObject([{ userId: actor, role: "moderator" }]);
      expect(occurrence.history?.appearances).toEqual([]);
      expect(occurrence.history?.proposalRepresentations).toEqual([
        {
          userId: actor,
          actingIdentityId: selection === "identity" ? source.identityId : null,
          selectedAt: selection === "unrecorded" ? null : selectedAt,
          snapshot:
            selection === "unrecorded"
              ? null
              : selection === "identity"
                ? affiliation
                : { ...affiliation, organizationName: null, jobTitle: null },
        },
      ]);
      expect(JSON.stringify(occurrence.history)).not.toContain("Account employer");
      expect((await request("/publications", { expectedRevision: result.agenda.revision })).status).toBe(422);
    },
  );

  it.each(["pending", "ended", "blocked"])("rejects a %s canonical representation atomically", async (state) => {
    const source = await fixture();
    if (state === "pending")
      await env.DB.prepare("UPDATE identities SET started_at=NULL WHERE id=?").bind(source.identityId).run();
    if (state === "ended" || state === "blocked")
      await env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=? WHERE id=?")
        .bind(selectedAt, state === "blocked" ? selectedAt : null, source.identityId)
        .run();
    const response = await request("/imports", {
      expectedRevision: 0,
      source: "accepted_proposals",
      proposalIds: [source.proposalId],
      dryRun: false,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_REPRESENTATION_IDENTITY_UNAVAILABLE" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents").first("count")).toBe(0);
  });

  it("rejects another person's identity through the mounted history route and preserves SQL ownership protection", async () => {
    const source = await fixture(),
      other = await insertUser(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, source.organizationId);
    const foreignIdentity = await addRepresentative(env.DB, memberId, other);
    const result = await imported(source.proposalId),
      occurrence = result.agenda.occurrences[0];
    const audits = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count");
    const response = await request(`/occurrences/${occurrence.id}/history`, {
      expectedRevision: result.agenda.revision,
      history: sessionHistoryMetadataSchema.parse({
        ...occurrence.history,
        appearances: [
          {
            userId: actor,
            actingIdentityId: foreignIdentity,
            displayName: "Canonical speaker",
            jobTitle: null,
            organizationName: affiliation.organizationName,
            biography: "",
            photoUrl: null,
            approvedAt: selectedAt,
          },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "APPEARANCE_IDENTITY_MISMATCH" } });
    expect(
      await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?").bind(eventId).first("revision"),
    ).toBe(result.agenda.revision);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count")).toBe(audits);
    await expect(
      env.DB.prepare("UPDATE identities SET user_id=? WHERE id=?").bind(other, source.identityId).run(),
    ).rejects.toThrow("IDENTITY_SCOPE_IMMUTABLE");
    await expect(
      env.DB.prepare("UPDATE proposal_speakers SET acting_identity_id=? WHERE id=?")
        .bind(foreignIdentity, source.speakerId)
        .run(),
    ).rejects.toThrow("PROPOSAL_SPEAKER_IDENTITY_BINDING_INVALID");
    expect(
      await env.DB.prepare("SELECT acting_identity_id FROM proposal_speakers WHERE id=?")
        .bind(source.speakerId)
        .first("acting_identity_id"),
    ).toBe(source.identityId);
    expect(
      await env.DB.prepare("SELECT user_id FROM identities WHERE id=?").bind(source.identityId).first("user_id"),
    ).toBe(actor);
  });

  it("validates placement at the actual occurrence start rather than the event start", async () => {
    const source = await fixture();
    const revision = await ensureRoom(0);
    await env.DB.prepare("UPDATE identities SET started_at='2026-12-01T09:00:00.000Z' WHERE id=?")
      .bind(source.identityId)
      .run();
    const early = await request("/imports", {
      expectedRevision: revision,
      source: "accepted_proposals",
      proposalIds: [source.proposalId],
      dryRun: true,
      proposalPlacement: {
        proposalId: source.proposalId,
        startAt: "2026-12-01T08:30:00.000Z",
        endAt: "2026-12-01T09:00:00.000Z",
        roomId,
      },
    });
    expect(early.status).toBe(422);
    const result = await imported(source.proposalId, revision, true);
    expect(result.agenda.occurrences[0].startAt).toBe(startAt);
  });

  it("rejects clearing or forging source provenance without revising or auditing the draft", async () => {
    const source = await fixture("unrecorded"),
      result = await imported(source.proposalId, 0, true),
      occurrence = result.agenda.occurrences[0];
    const audits = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count");
    for (const proposalRepresentations of [
      [],
      [
        {
          ...occurrence.history!.proposalRepresentations[0],
          selectedAt,
          snapshot: { ...affiliation, organizationName: null, jobTitle: null },
        },
      ],
    ]) {
      const response = await request(`/occurrences/${occurrence.id}/history`, {
        expectedRevision: result.agenda.revision,
        history: { ...occurrence.history, proposalRepresentations },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "PROPOSAL_REPRESENTATION_PROVENANCE_IMMUTABLE" } });
    }
    const forgedSource = await request(`/occurrences/${occurrence.id}/history`, {
      expectedRevision: result.agenda.revision,
      history: {
        ...occurrence.history,
        sourceDecisions: [
          {
            kind: "title",
            sourcePath: "content/events/synthetic/index.md",
            sourceDigest: "a".repeat(64),
            sourceLocator: "title",
            authoredValue: "Authored title",
            decision: "reviewed_title",
            resolvedValue: "Authored title",
            reviewedAt: selectedAt,
          },
        ],
      },
    });
    expect(forgedSource.status).toBe(400);
    expect(await forgedSource.json()).toMatchObject({ error: { code: "SOURCE_DECISION_PROVENANCE_IMMUTABLE" } });
    expect(
      await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?").bind(eventId).first("revision"),
    ).toBe(result.agenda.revision);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count")).toBe(audits);
    expect((await request("/publications", { expectedRevision: result.agenda.revision })).status).toBe(422);
  });

  it("defers unscheduled date validation and checks both direct placement and schedule review", async () => {
    const source = await fixture();
    await env.DB.prepare("UPDATE identities SET started_at='2026-12-01T12:00:00.000Z' WHERE id=?")
      .bind(source.identityId)
      .run();
    const result = await imported(source.proposalId),
      occurrence = result.agenda.occurrences[0];
    const choices = await callApi(
      env,
      `/api/v1/events/pqc-2026/agenda/occurrences/${occurrence.id}/history/identities?limit=25&offset=0`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(choices.status).toBe(200);
    expect(sessionAppearanceChoicesSchema.parse(await choices.json()).identities.map((item) => item.id)).toContain(
      source.identityId,
    );
    const change = { id: occurrence.id, startAt, endAt, roomId: null, additionalRoomIds: [] };
    for (const response of [
      await request(
        `/occurrences/${occurrence.id}`,
        { expectedRevision: result.agenda.revision, startAt, endAt },
        "PATCH",
      ),
      await request("/schedule/reviews", { expectedRevision: result.agenda.revision, changes: [change] }),
    ])
      expect(response.status).toBe(422);
    const approved = sessionHistoryMetadataSchema.parse({
      ...occurrence.history,
      appearances: [
        {
          userId: actor,
          actingIdentityId: null,
          displayName: "Verified individual credit",
          jobTitle: null,
          organizationName: null,
          biography: "",
          photoUrl: null,
          approvedAt: selectedAt,
        },
      ],
    });
    const saved = await request(`/occurrences/${occurrence.id}/history`, {
      expectedRevision: result.agenda.revision,
      history: approved,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const revision = agendaSnapshotSchema.parse(await saved.json()).revision;
    expect(
      (await request(`/occurrences/${occurrence.id}`, { expectedRevision: revision, startAt, endAt }, "PATCH")).status,
    ).toBe(200);
  });

  it("preserves approved publication and editorial credits through profile changes and reviewed reimports", async () => {
    const source = await fixture(),
      result = await imported(source.proposalId, 0, true),
      occurrence = result.agenda.occurrences[0];
    const appearance = {
      userId: actor,
      actingIdentityId: source.identityId,
      displayName: "Approved original speaker",
      ...affiliation,
      photoUrl: null,
      approvedAt: selectedAt,
    };
    const saved = await request(`/occurrences/${occurrence.id}/history`, {
      expectedRevision: result.agenda.revision,
      history: sessionHistoryMetadataSchema.parse({ ...occurrence.history, appearances: [appearance] }),
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const approved = await request("/publications", {
      expectedRevision: agendaSnapshotSchema.parse(await saved.json()).revision,
    });
    expect(approved.status, await approved.clone().text()).toBe(200);
    const published = agendaSnapshotSchema.parse(await approved.json());
    const frozen = await env.DB.prepare(
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=?",
    )
      .bind(eventId, published.revision)
      .first("snapshot_json");
    await env.DB.prepare(
      "UPDATE users SET preferred_name='Changed profile name',organization_name='New employer',job_title='New role' WHERE id=?",
    )
      .bind(actor)
      .run();
    await env.DB.prepare(
      "UPDATE identities SET job_title='New identity role',biography='New identity biography' WHERE id=?",
    )
      .bind(source.identityId)
      .run();
    const retry = await imported(source.proposalId, published.revision);
    expect(retry.agenda.occurrences[0].history?.appearances).toEqual([
      expect.objectContaining({
        displayName: appearance.displayName,
        jobTitle: affiliation.jobTitle,
        organizationName: affiliation.organizationName,
      }),
    ]);
    expect(retry.reviewRequired).toBe(0);
    const incoming = { ...affiliation, jobTitle: "New source role" };
    await env.DB.prepare("UPDATE proposal_speakers SET acting_identity_snapshot_json=? WHERE id=?")
      .bind(JSON.stringify(incoming), source.speakerId)
      .run();
    const review = await imported(source.proposalId, retry.agenda.revision);
    expect(review.reviewRequired).toBe(1);
    expect(review.agenda.occurrences[0].history?.proposalRepresentations[0].snapshot).toEqual(affiliation);
    const contentsResponse = await callApi(env, "/api/v1/events/pqc-2026/agenda/contents?limit=25&offset=0", {
      headers: { authorization: `Bearer ${token}` },
    });
    const content = agendaContentsResponseSchema.parse(await contentsResponse.json()).contents[0];
    expect(content.review?.incomingProposalRepresentations?.[0].snapshot).toEqual(incoming);
    const accepted = await request(
      `/contents/${content.id}`,
      { expectedRevision: review.agenda.revision, content: content.review!.incoming, resolveSourceReview: true },
      "PATCH",
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const after = await imported(source.proposalId, review.agenda.revision + 1);
    expect(after.reviewRequired).toBe(0);
    expect(after.agenda.occurrences[0].history?.proposalRepresentations[0].snapshot).toEqual(incoming);
    expect(after.agenda.occurrences[0].history?.appearances[0].jobTitle).toBe(affiliation.jobTitle);
    expect(
      await env.DB.prepare("SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=?")
        .bind(eventId, published.revision)
        .first("snapshot_json"),
    ).toBe(frozen);
  });
});
