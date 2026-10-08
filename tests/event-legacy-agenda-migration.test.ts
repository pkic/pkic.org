import { beforeEach, describe, expect, it } from "vitest";
import { grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import mediaInventory from "./fixtures/legacy-agenda-2023-media.json";
import {
  transferApplySchema,
  transferPrepareSchema,
  transferReviewSchema,
} from "../assets/shared/schemas/event-agenda-transfer";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { patchAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";

const eventId = crypto.randomUUID(),
  actorId = crypto.randomUUID(),
  roomId = crypto.randomUUID();
const slug = "legacy-pqc-2023-migration";
beforeEach(async () => {
  await resetDb();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
    .bind(actorId, "legacy-migration@example.test", "legacy-migration@example.test")
    .run();
  await grantAdministrator(env.DB, actorId);
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,?,'America/Toronto','{}',?,?)",
  )
    .bind(eventId, slug, "Historical PQC conference", now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,NULL,?)",
  )
    .bind(eventId, now)
    .run();
  await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Plenary',200)")
    .bind(roomId, eventId)
    .run();
});

describe("actual legacy source through reviewed native agenda migration", () => {
  it("imports verified slides and offset recording as draft, retries without duplicates and preserves organizer edits", async () => {
    const prepared = {
      document: structuredClone(mediaInventory.document),
      unresolved: mediaInventory.preparationUnresolved,
    };
    expect(prepared.document.source.sourceDigest).toBe(mediaInventory.sourceDigest);
    // This integration deliberately selects one real, fully timed session.
    // The full archive's unresolved historical credits are not release approvals.
    expect(prepared.unresolved).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "historical_representation" })]),
    );
    const row = prepared.document.occurrences.find((item) => item.fields.title === "Welcome");
    expect(row).toBeDefined();
    const sourceReceipt = {
      sourcePath: mediaInventory.sourcePath,
      sourceDigest: mediaInventory.sourceDigest,
      sourceLocator: row!.ref,
    };
    const legacyFragments = [
      { anchor: "sessionModal-900-0-welcome", kind: "dialog" },
      { anchor: "sessionModal-900-0-welcome-label", kind: "dialog_label" },
    ].map((fragment) => ({
      ...sourceReceipt,
      ...fragment,
      authoredDate: "2023-03-03",
      authoredStart: "9:00",
      authoredTitle: "Welcome",
      roomRef: "plenary",
      roomId: null,
    }));
    const legacyDownloads = [
      {
        ...sourceReceipt,
        url: "/events/2023/post-quantum-cryptography-conference/pkic-pqcc-welcome-paul-van-brouwershaven.pdf",
        targetUrl: mediaInventory.presentationUrls["pkic-pqcc-welcome-paul-van-brouwershaven.pdf"],
        pdfDigest: "5fa2fb3f5c0cc521a21ddd3fb79d15f22d203e4156f69d77c0a1333b111a771e",
        pdfBytes: 903915,
      },
    ];
    // Authored link receipts retain provenance without granting historical release approval.
    expect(row!.archive).toEqual({
      sessionSlug: null,
      legacyPaths: [],
      prerequisites: "",
      sourceDecisions: [],
      appearances: [],
      archivalCredits: [],
      archivalTiming: null,
      materials: [],
      legacyFragments,
      legacyDownloads,
    });
    const input = transferPrepareSchema.parse({
      expectedRevision: 0,
      mode: "archive",
      document: { ...prepared.document, occurrences: [row!] },
      resolutions: {
        people: { "Paul van Brouwershaven": { userId: actorId, actingIdentityId: null } },
        rooms: { plenary: roomId },
        media: {},
        rows: {},
      },
    });
    const token = await createAdminSession(env.DB, actorId, "legacy-archive-route");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const base = `/api/v1/events/${slug}/agenda/transfers`;
    async function apply() {
      const reviewed = await callApi(env, `${base}/reviews`, { method: "POST", headers, body: JSON.stringify(input) });
      expect(reviewed.status, await reviewed.clone().text()).toBe(200);
      const review = transferReviewSchema.parse(await reviewed.json());
      expect(review.ready).toBe(true);
      const request = transferApplySchema.parse({
        ...input,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      });
      const response = await callApi(env, base, { method: "POST", headers, body: JSON.stringify(request) });
      expect(response.status, await response.clone().text()).toBe(200);
      const result = (await response.json()) as { imported: number; agenda: unknown };
      return { imported: result.imported, agenda: agendaSnapshotSchema.parse(result.agenda), review };
    }
    const imported = await apply();
    expect(imported.imported).toBe(1);
    expect(imported.agenda.publishedRevision).toBeNull();
    const session = imported.agenda.occurrences[0]!;
    expect(session).toMatchObject({ title: "Welcome", presentationUrl: null, recordingUrl: null });
    expect(session.history!.appearances).toEqual([]);
    expect(session.history!.legacyFragments).toEqual(legacyFragments.map((fragment) => ({ ...fragment, roomId })));
    expect(session.history!.legacyDownloads).toEqual(legacyDownloads);
    expect(session.history!.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "presentation",
          url: mediaInventory.presentationUrls["pkic-pqcc-welcome-paul-van-brouwershaven.pdf"],
        }),
        expect.objectContaining({ kind: "recording", url: "https://www.youtube.com/watch?v=o-1sSF_xP5Q&start=1499" }),
      ]),
    );
    for (const material of session.history!.materials)
      expect(material).toMatchObject({
        status: "draft",
        rightsConfirmed: false,
        consentConfirmed: false,
        validated: false,
        approvedAt: null,
        presentationVersionId: null,
      });
    const provenance = await env.DB.prepare(
      "SELECT source_digest,source_path,media_json FROM event_agenda_import_provenance WHERE occurrence_id=?",
    )
      .bind(session.id)
      .first<{ source_digest: string; source_path: string; media_json: string }>();
    expect(provenance).toMatchObject({
      source_digest: mediaInventory.sourceDigest,
      source_path: mediaInventory.sourcePath,
    });
    expect(JSON.parse(provenance!.media_json)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "presentation",
          sourceDigest: mediaInventory.mediaDigests["pkic-pqcc-welcome-paul-van-brouwershaven.pdf"],
        }),
      ]),
    );
    input.expectedRevision = imported.agenda.revision;
    const retried = await apply();
    expect(retried.imported).toBe(0);
    expect(retried.agenda.occurrences).toHaveLength(1);
    expect(retried.agenda.occurrences[0]!.history!.materials.map((item) => item.id)).toEqual(
      session.history!.materials.map((item) => item.id),
    );
    expect(retried.agenda.occurrences[0]!.history!.legacyFragments).toEqual(session.history!.legacyFragments);
    expect(retried.agenda.occurrences[0]!.history!.legacyDownloads).toEqual(session.history!.legacyDownloads);
    const edited = await patchAgendaOccurrence(
      env.DB,
      eventId,
      slug,
      session.id,
      { expectedRevision: retried.agenda.revision, title: "Organizer's retained title" },
      actorId,
    );
    input.expectedRevision = edited.revision;
    input.document.occurrences[0]!.fields.title = "Changed historical source title";
    const retained = await apply();
    expect(retained.review.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "local_edits" })]),
    );
    expect(retained.imported).toBe(0);
    expect(retained.agenda.occurrences[0]!.title).toBe("Organizer's retained title");
    expect(retained.agenda.occurrences[0]!.history!.legacyFragments).toEqual(session.history!.legacyFragments);
    expect(retained.agenda.occurrences[0]!.history!.legacyDownloads).toEqual(session.history!.legacyDownloads);
    expect(retained.agenda.occurrences[0]!.history!.materials.every((item) => item.status === "draft")).toBe(true);
  });
});
