import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  agendaOccurrencePatchSchema,
  agendaPublicationSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import {
  transferApplySchema,
  transferApplyResponseSchema,
  transferPrepareSchema,
  transferReviewSchema,
} from "../assets/shared/schemas/event-agenda-transfer";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";
import { publicSessionCredits } from "../assets/shared/session-public-credits";
import { publicSessionTiming } from "../assets/shared/session-public-timing";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { historicalAgendaReviewInput } from "./helpers/historical-agenda-review";
import { individualAppearanceFixture } from "./helpers/agenda-appearances";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import type { DatabaseLike } from "../functions/_lib/types";

const sourcePath = "/events/historical/";
const sourceDigest = "a".repeat(64);
const reviewedAt = "2023-04-02T00:00:00.000Z";
const acknowledgmentAuditSql =
  "SELECT actor_id FROM audit_log WHERE action='agenda.archive.representation.acknowledged'";

async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare(
    "UPDATE events SET slug='historical',name='Historical conference',timezone='UTC',visibility='public',source_path=?,starts_at='2023-04-01T00:00:00.000Z',ends_at='2023-04-02T00:00:00.000Z' WHERE id=?",
  )
    .bind(sourcePath, eventId)
    .run();
  const token = await createAdminSession(env.DB, admin.id, "historical-publication");
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const request = (path: string, body: unknown, database: DatabaseLike = env.DB, slug = "historical") =>
    callApi({ ...env, DB: database }, `/api/v1/events/${slug}/agenda${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const value = historicalAgendaReviewInput({
    actor: admin.id,
    sourcePath,
    sourceDigest,
    sourceLocator: "talk",
    approvedAt: reviewedAt,
  });
  value.document.people = value.document.people.filter((person) => person.canonicalUserId === null);
  value.document.occurrences[0]!.personRefs = ["Authored speaker"];
  value.document.occurrences[0]!.archive!.appearances = [];
  value.document.occurrences[0]!.archive!.materials = [];
  return { eventId, actor: admin.id, headers, request, value };
}

/** An authored networking row has no missing-speaker decision to manufacture. */
function emptyArchive(context: Awaited<ReturnType<typeof fixture>>) {
  const value = context.value;
  value.document.people = [];
  const row = value.document.occurrences[0]!;
  row.fields.title = "Networking";
  row.fields.kind = "break";
  row.personRefs = [];
  row.archive!.archivalCredits = [];
  row.archive!.sourceDecisions = [];
  row.archive!.legacyFragments = [];
  row.timing.endAt = null;
  row.timing.endSource = "unresolved";
  row.archive!.archivalTiming = {
    sourcePath,
    sourceDigest,
    provenance: "authored_public",
    timeZone: row.timing.timeZone,
    authoredDate: row.timing.authoredDate,
    authoredStart: row.timing.authoredStart,
    startAt: row.timing.startAt!,
    endAt: null,
  };
  return value;
}

async function applyArchive(context: Awaited<ReturnType<typeof fixture>>, value = context.value, slug = "historical") {
  const reviewed = await context.request("/transfers/reviews", transferPrepareSchema.parse(value), env.DB, slug);
  expect(reviewed.status, await reviewed.clone().text()).toBe(200);
  const review = transferReviewSchema.parse(await reviewed.json());
  expect(review.ready, JSON.stringify(review.findings)).toBe(true);
  const response = await context.request(
    "/transfers",
    transferApplySchema.parse({
      ...value,
      reviewDigest: review.digest,
      acknowledgeInferredTiming: true,
      acknowledgeArchiveRepresentation: true,
    }),
    env.DB,
    slug,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return transferApplyResponseSchema.parse(await response.json()).agenda;
}

async function effects() {
  return Promise.all(
    [
      "SELECT event_id,revision,published_revision,updated_at FROM event_agenda_state ORDER BY event_id",
      "SELECT id,event_id,revision,snapshot_json,created_by,created_at FROM event_agenda_publications ORDER BY id",
      "SELECT event_id,revision,occurrence_id,payload_json,room_json FROM event_agenda_published_occurrences ORDER BY event_id,revision,occurrence_id",
      "SELECT id,event_id,content_id,source_key,start_at,end_at FROM event_agenda_occurrences ORDER BY id",
      "SELECT occurrence_id,metadata_json,updated_by,updated_at FROM event_agenda_session_history ORDER BY occurrence_id",
      "SELECT occurrence_id,import_mode,source_path,source_digest,source_ref,timing_json,people_json FROM event_agenda_import_provenance ORDER BY occurrence_id",
      "SELECT id,event_id,source_key,source_snapshot_json,source_review_json FROM event_agenda_contents ORDER BY id",
      "SELECT event_id,revision,occurrence_id,user_id,attendance_mode,room_id,sources_json FROM event_agenda_operational_people ORDER BY event_id,revision,occurrence_id,user_id",
      "SELECT event_id,revision,day_date,user_id,sources_json FROM event_agenda_operational_days ORDER BY event_id,revision,day_date,user_id",
      "SELECT id,actor_id,action,details_json FROM audit_log ORDER BY id",
      "SELECT id,resource_id,revision,reason_code,status FROM site_publication_requests ORDER BY id",
      "SELECT id,template_key,status,payload_json FROM email_outbox ORDER BY id",
    ].map((sql) => queryAll(env.DB, sql)),
  );
}

async function peopleAndAuthority() {
  return Promise.all(
    [
      "SELECT id,email,normalized_email FROM users ORDER BY id",
      "SELECT id,user_id,organization_id,source,job_title FROM identities ORDER BY id",
      "SELECT id,name FROM organizations ORDER BY id",
      "SELECT id,organization_id,user_id FROM members ORDER BY id",
      "SELECT member_id,category_code FROM member_category_assignments ORDER BY member_id",
      "SELECT identity_id,member_id,member_status FROM identity_member_capacities ORDER BY identity_id,member_id",
      "SELECT id,user_id,role_id,context_type,context_id FROM user_roles ORDER BY id",
      "SELECT occurrence_id,user_id FROM event_agenda_occurrence_speakers ORDER BY occurrence_id,user_id",
      "SELECT event_id,revision,occurrence_id,user_id,attendance_mode,room_id FROM event_agenda_operational_people ORDER BY event_id,revision,occurrence_id,user_id",
      "SELECT event_id,revision,day_date,user_id FROM event_agenda_operational_days ORDER BY event_id,revision,day_date,user_id",
      "SELECT occurrence_id,user_id,status,attendance_mode,room_id FROM agenda_session_participations ORDER BY occurrence_id,user_id",
      "SELECT id,occurrence_id,user_id,expires_at,revoked_at FROM agenda_session_holds ORDER BY id",
    ].map((sql) => queryAll(env.DB, sql)),
  );
}

async function approved(eventId: string) {
  const [row] = await queryAll<{ snapshot_json: string }>(
    env.DB,
    "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? ORDER BY revision DESC LIMIT 1",
    eventId,
  );
  expect(row).toBeDefined();
  return agendaSnapshotSchema.parse(JSON.parse(row!.snapshot_json));
}

async function refuse(context: Awaited<ReturnType<typeof fixture>>, revision: number, code: string, ack = true) {
  const before = await effects();
  const response = await context.request(
    "/publications",
    agendaPublicationSchema.parse({
      expectedRevision: revision,
      ...(ack ? { acknowledgeArchiveRepresentation: true } : {}),
    }),
  );
  expect(response.status).toBe(ack ? 422 : 400);
  expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe(code);
  expect(await effects()).toEqual(before);
}

describe("reviewed source-only historical agenda publication", () => {
  beforeEach(resetDb);

  it("publishes the reviewed authored credit exactly without creating canonical people or authority", async () => {
    const context = await fixture();
    const population = await peopleAndAuthority();
    const imported = await applyArchive(context);
    const row = context.value.document.occurrences[0]!;
    expect(imported.occurrences[0]!.speakers).toEqual([]);
    expect(await peopleAndAuthority()).toEqual(population);
    const published = await context.request(
      "/publications",
      agendaPublicationSchema.parse({
        expectedRevision: imported.revision,
        acknowledgeArchiveRepresentation: true,
      }),
    );
    expect(published.status, await published.clone().text()).toBe(200);
    const result = agendaSnapshotSchema.parse(await published.json());
    const snapshot = await approved(context.eventId);
    expect(result.publishedRevision).toBe(imported.revision + 1);
    expect(snapshot.occurrences[0]!.history!.archivalCredits).toEqual(row.archive!.archivalCredits);
    expect(snapshot.occurrences[0]!.speakers).toEqual([]);
    expect(publicSessionCredits(snapshot.occurrences[0]!)).toEqual(row.archive!.archivalCredits);
    expect(publicSessionCredits(snapshot.occurrences[0]!).every((credit) => !("userId" in credit))).toBe(true);
    expect(await peopleAndAuthority()).toEqual(population);
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_publications")).toHaveLength(1);
  });

  it("publishes an explicitly unrecorded credit and unknown end without fabricating people or an interval", async () => {
    const context = await fixture();
    const value = historicalAgendaReviewInput(
      {
        actor: context.actor,
        sourcePath,
        sourceDigest,
        sourceLocator: "talk",
        approvedAt: reviewedAt,
      },
      true,
    );
    value.document.people = [];
    const row = value.document.occurrences[0]!;
    row.personRefs = [];
    row.archive!.appearances = [];
    row.archive!.materials = [];
    row.timing.endAt = null;
    row.timing.endSource = "unresolved";
    row.archive!.archivalTiming = {
      sourcePath,
      sourceDigest,
      provenance: "authored_public",
      timeZone: "UTC",
      authoredDate: row.timing.authoredDate,
      authoredStart: row.timing.authoredStart,
      startAt: row.timing.startAt!,
      endAt: null,
    };
    const population = await peopleAndAuthority();
    const imported = await applyArchive(context, value);
    const published = await context.request(
      "/publications",
      agendaPublicationSchema.parse({
        expectedRevision: imported.revision,
        acknowledgeArchiveRepresentation: true,
      }),
    );
    expect(published.status, await published.clone().text()).toBe(200);
    const occurrence = (await approved(context.eventId)).occurrences[0]!;
    expect(occurrence).toMatchObject({
      title: "Title not recorded",
      startAt: null,
      endAt: null,
      speakers: [],
    });
    expect(occurrence.history!.archivalTiming).toEqual(row.archive!.archivalTiming);
    expect(occurrence.history!.sourceDecisions).toEqual(row.archive!.sourceDecisions);
    expect(publicSessionTiming(occurrence)).toEqual({
      startAt: row.timing.startAt,
      endAt: undefined,
      endNotRecorded: true,
    });
    expect(publicSessionCredits(occurrence)).toEqual([]);
    expect(await peopleAndAuthority()).toEqual(population);
  });

  it("publishes an acknowledged creditless networking row with only honest unknown-end evidence", async () => {
    const context = await fixture();
    const value = emptyArchive(context);
    const population = await peopleAndAuthority();
    const imported = await applyArchive(context, value);
    await refuse(context, imported.revision, "AGENDA_PUBLICATION_ARCHIVE_REVIEW_REQUIRED", false);
    const published = await context.request(
      "/publications",
      agendaPublicationSchema.parse({ expectedRevision: imported.revision, acknowledgeArchiveRepresentation: true }),
    );
    expect(published.status, await published.clone().text()).toBe(200);
    const occurrence = (await approved(context.eventId)).occurrences[0]!;
    expect(occurrence).toMatchObject({ title: "Networking", startAt: null, endAt: null, speakers: [] });
    expect(occurrence.history).toMatchObject({
      archivalCredits: [],
      sourceDecisions: [],
      legacyFragments: [],
      appearances: [],
      materials: [],
      archivalTiming: value.document.occurrences[0]!.archive!.archivalTiming,
    });
    expect(publicSessionCredits(occurrence)).toEqual([]);
    expect(publicSessionTiming(occurrence)).toEqual({
      startAt: value.document.occurrences[0]!.timing.startAt,
      endAt: undefined,
      endNotRecorded: true,
    });
    expect(await peopleAndAuthority()).toEqual(population);
    expect(await queryAll(env.DB, acknowledgmentAuditSql)).toEqual([{ actor_id: context.actor }]);
  });

  it.each(["authored", "forged_copy_key"] as const)(
    "refuses an invented end on a %s creditless archive after clearing its only historical marker",
    async (kind) => {
      const context = await fixture();
      const value = emptyArchive(context);
      if (kind === "forged_copy_key") value.document.occurrences[0]!.sourceKey = `copy:${sourceDigest}:talk`;
      const imported = await applyArchive(context, value);
      const occurrence = imported.occurrences[0]!;
      expect(
        await env.DB.prepare("SELECT import_mode FROM event_agenda_import_provenance WHERE occurrence_id=?")
          .bind(occurrence.id)
          .first<string>("import_mode"),
      ).toBe("archive");
      const originalTiming = await env.DB.prepare(
        "SELECT timing_json FROM event_agenda_import_provenance WHERE occurrence_id=?",
      )
        .bind(occurrence.id)
        .first<string>("timing_json");
      expect(originalTiming).toBeTruthy();
      expect(JSON.parse(originalTiming!)).toMatchObject({ endAt: null, endSource: "unresolved" });
      await env.DB.prepare("UPDATE event_agenda_occurrences SET start_at=?,end_at=? WHERE id=?")
        .bind(value.document.occurrences[0]!.timing.startAt, "2023-04-01T11:00:00.000Z", occurrence.id)
        .run();
      await env.DB.prepare(
        "UPDATE event_agenda_session_history SET metadata_json=json_set(metadata_json,'$.archivalTiming',json('null')) WHERE occurrence_id=?",
      )
        .bind(occurrence.id)
        .run();
      const stored = sessionHistoryMetadataSchema.parse(
        JSON.parse(
          (await env.DB.prepare("SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?")
            .bind(occurrence.id)
            .first<string>("metadata_json"))!,
        ),
      );
      expect(stored).toMatchObject({
        archivalTiming: null,
        archivalCredits: [],
        sourceDecisions: [],
        legacyFragments: [],
        appearances: [],
      });
      expect(
        await env.DB.prepare("SELECT timing_json FROM event_agenda_import_provenance WHERE occurrence_id=?")
          .bind(occurrence.id)
          .first<string>("timing_json"),
      ).toBe(originalTiming);
      await refuse(context, imported.revision, "AGENDA_HISTORICAL_MAPPING_REQUIRED");
    },
  );

  it("allows a genuine copy_as_new of unknown-end source to be planned and approved for a future event", async () => {
    const context = await fixture();
    const value = emptyArchive(context);
    value.mode = "copy_as_new";
    const startAt = "2099-04-01T10:00:00.000Z",
      endAt = "2099-04-01T11:00:00.000Z";
    await env.DB.prepare(
      "UPDATE events SET starts_at='2099-04-01T00:00:00.000Z',ends_at='2099-04-02T00:00:00.000Z' WHERE id=?",
    )
      .bind(context.eventId)
      .run();
    const population = await peopleAndAuthority();
    const copied = await applyArchive(context, value);
    const occurrence = copied.occurrences[0]!;
    expect(
      await env.DB.prepare("SELECT import_mode FROM event_agenda_import_provenance WHERE occurrence_id=?")
        .bind(occurrence.id)
        .first<string>("import_mode"),
    ).toBe("copy_as_new");
    expect(occurrence).toMatchObject({ startAt: null, endAt: null, visibility: "private", speakers: [] });
    expect(occurrence.history).toMatchObject({
      archivalTiming: null,
      archivalCredits: [],
      sourceDecisions: [],
      legacyFragments: [],
      appearances: [],
    });
    const originalTiming = await env.DB.prepare(
      "SELECT timing_json FROM event_agenda_import_provenance WHERE occurrence_id=?",
    )
      .bind(occurrence.id)
      .first<string>("timing_json");
    expect(originalTiming).toBeTruthy();
    const scheduled = await callApi(env, `/api/v1/events/historical/agenda/occurrences/${occurrence.id}`, {
      method: "PATCH",
      headers: context.headers,
      body: JSON.stringify(
        agendaOccurrencePatchSchema.parse({ expectedRevision: copied.revision, startAt, endAt, visibility: "public" }),
      ),
    });
    expect(scheduled.status, await scheduled.clone().text()).toBe(200);
    const planned = agendaSnapshotSchema.parse(await scheduled.json());
    const publication = await context.request(
      "/publications",
      agendaPublicationSchema.parse({ expectedRevision: planned.revision }),
    );
    expect(publication.status, await publication.clone().text()).toBe(200);
    const publicCopy = (await approved(context.eventId)).occurrences[0]!;
    expect(publicCopy).toMatchObject({ title: "Networking", startAt, endAt, speakers: [] });
    expect(publicSessionTiming(publicCopy)).toEqual({ startAt, endAt, endNotRecorded: false });
    expect(publicSessionCredits(publicCopy)).toEqual([]);
    expect(
      await env.DB.prepare("SELECT timing_json FROM event_agenda_import_provenance WHERE occurrence_id=?")
        .bind(occurrence.id)
        .first<string>("timing_json"),
    ).toBe(originalTiming);
    expect(await peopleAndAuthority()).toEqual(population);
    expect(await queryAll(env.DB, acknowledgmentAuditSql)).toEqual([]);
  });

  it("refuses missing publication acknowledgment after an acknowledged transfer without any effects", async () => {
    const context = await fixture();
    const imported = await applyArchive(context);
    expect(
      agendaPublicationSchema.parse({ expectedRevision: imported.revision }).acknowledgeArchiveRepresentation,
    ).toBe(false);
    await refuse(context, imported.revision, "AGENDA_PUBLICATION_ARCHIVE_REVIEW_REQUIRED", false);
  });

  it.each(["missing", "forged"] as const)(
    "refuses %s stored source provenance despite acknowledgment",
    async (kind) => {
      const context = await fixture();
      const imported = await applyArchive(context);
      if (kind === "missing")
        await env.DB.prepare("DELETE FROM event_agenda_import_provenance WHERE occurrence_id=?")
          .bind(imported.occurrences[0]!.id)
          .run();
      else
        await env.DB.prepare("UPDATE event_agenda_import_provenance SET source_digest=? WHERE occurrence_id=?")
          .bind("f".repeat(64), imported.occurrences[0]!.id)
          .run();
      await refuse(context, imported.revision, "AGENDA_HISTORICAL_MAPPING_REQUIRED");
    },
  );

  it("refuses cross-event source content relinking without changing or publishing either event", async () => {
    const context = await fixture();
    const imported = await applyArchive(context);
    const otherEvent = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,visibility,settings_json,created_at,updated_at) VALUES(?,'other-history','Other archive','UTC','public','{}',?,?)",
    )
      .bind(otherEvent, reviewedAt, reviewedAt)
      .run();
    const other = await applyArchive(context, context.value, "other-history");
    expect(other.occurrences[0]!.contentId).toBeTruthy();
    const snapshots = async () =>
      Promise.all(
        ["historical", "other-history"].map(async (slug) => {
          const response = await callApi(env, `/api/v1/events/${slug}/agenda`, { headers: context.headers });
          expect(response.status).toBe(200);
          return agendaSnapshotSchema.parse(await response.json());
        }),
      );
    const before = await Promise.all([effects(), peopleAndAuthority(), snapshots()]);
    await expect(
      env.DB.prepare("UPDATE event_agenda_occurrences SET content_id=? WHERE id=?")
        .bind(other.occurrences[0]!.contentId, imported.occurrences[0]!.id)
        .run(),
    ).rejects.toThrow("agenda_content_event_mismatch");
    expect(await Promise.all([effects(), peopleAndAuthority(), snapshots()])).toEqual(before);
  });

  it("refuses a stored future source interval rather than treating it as a past archive", async () => {
    const context = await fixture();
    const imported = await applyArchive(context);
    const timing = {
      ...context.value.document.occurrences[0]!.timing,
      startAt: "2099-04-01T10:00:00.000Z",
      endAt: "2099-04-01T11:00:00.000Z",
      authoredDate: "2099-04-01",
    };
    await env.DB.prepare("UPDATE event_agenda_import_provenance SET timing_json=? WHERE occurrence_id=?")
      .bind(JSON.stringify(timing), imported.occurrences[0]!.id)
      .run();
    await refuse(context, imported.revision, "AGENDA_HISTORICAL_MAPPING_REQUIRED");
  });

  it.each(["unknown_end", "complete_interval"] as const)(
    "refuses an invented canonical interval after importing %s source timing",
    async (kind) => {
      const context = await fixture();
      const row = context.value.document.occurrences[0]!;
      if (kind === "unknown_end") {
        row.timing.endAt = null;
        row.timing.endSource = "unresolved";
        row.archive!.archivalTiming = {
          sourcePath,
          sourceDigest,
          provenance: "authored_public",
          timeZone: row.timing.timeZone,
          authoredDate: row.timing.authoredDate,
          authoredStart: row.timing.authoredStart,
          startAt: row.timing.startAt!,
          endAt: null,
        };
      }
      const imported = await applyArchive(context);
      const occurrence = imported.occurrences[0]!;
      expect(occurrence.startAt).toBe(kind === "unknown_end" ? null : row.timing.startAt);
      const originalTiming = await env.DB.prepare(
        "SELECT timing_json FROM event_agenda_import_provenance WHERE occurrence_id=?",
      )
        .bind(occurrence.id)
        .first("timing_json");
      await env.DB.prepare("UPDATE event_agenda_occurrences SET start_at=?,end_at=? WHERE id=?")
        .bind("2023-04-01T12:00:00.000Z", "2023-04-01T13:00:00.000Z", occurrence.id)
        .run();
      await env.DB.prepare(
        "UPDATE event_agenda_session_history SET metadata_json=json_set(metadata_json,'$.archivalTiming',json('null')) WHERE occurrence_id=?",
      )
        .bind(occurrence.id)
        .run();
      expect(
        await env.DB.prepare("SELECT timing_json FROM event_agenda_import_provenance WHERE occurrence_id=?")
          .bind(occurrence.id)
          .first("timing_json"),
      ).toBe(originalTiming);
      await refuse(context, imported.revision, "AGENDA_HISTORICAL_MAPPING_REQUIRED");
    },
  );

  it("still requires a separately approved appearance for a canonical speaker mixed with authored credits", async () => {
    const context = await fixture();
    const value = historicalAgendaReviewInput({
      actor: context.actor,
      sourcePath,
      sourceDigest,
      sourceLocator: "talk",
      approvedAt: reviewedAt,
    });
    value.document.occurrences[0]!.archive!.appearances = [];
    value.document.occurrences[0]!.archive!.materials = [];
    const imported = await applyArchive(context, value);
    await refuse(context, imported.revision, "AGENDA_REPRESENTATION_REVIEW_REQUIRED");
    const occurrence = imported.occurrences[0]!;
    const appearance = individualAppearanceFixture({
      userId: context.actor,
      displayName: "Original moderator",
      approvedAt: reviewedAt,
    });
    const saved = await context.request(`/occurrences/${occurrence.id}/history`, {
      expectedRevision: imported.revision,
      history: sessionHistoryMetadataSchema.parse({
        ...occurrence.history,
        appearances: [appearance],
      }),
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const reviewed = agendaSnapshotSchema.parse(await saved.json());
    const published = await context.request(
      "/publications",
      agendaPublicationSchema.parse({
        expectedRevision: reviewed.revision,
        acknowledgeArchiveRepresentation: true,
      }),
    );
    expect(published.status, await published.clone().text()).toBe(200);
    const snapshot = await approved(context.eventId);
    expect(snapshot.occurrences[0]!.history!.appearances).toEqual([appearance]);
    expect(snapshot.occurrences[0]!.history!.archivalCredits).toEqual(
      value.document.occurrences[0]!.archive!.archivalCredits,
    );
  });

  it("rolls back publication when exact persisted provenance changes after preflight", async () => {
    const context = await fixture();
    const imported = await applyArchive(context);
    let armed = false;
    let raced = false;
    let afterMutation: Awaited<ReturnType<typeof effects>> | undefined;
    const racing = mutateBeforeNextBatch(env.DB, async () => {
      raced = true;
      await env.DB.prepare("UPDATE event_agenda_import_provenance SET source_digest=? WHERE occurrence_id=?")
        .bind("b".repeat(64), imported.occurrences[0]!.id)
        .run();
      afterMutation = await effects();
    });
    const database: DatabaseLike = {
      prepare(sql) {
        // Arm only the final publication command, after route authentication and source preflight.
        if (sql.includes("INSERT INTO event_agenda_publications")) armed = true;
        return env.DB.prepare(sql);
      },
      batch: (statements) => (armed ? racing : env.DB).batch(statements),
    };
    const response = await context.request(
      "/publications",
      agendaPublicationSchema.parse({
        expectedRevision: imported.revision,
        acknowledgeArchiveRepresentation: true,
      }),
      database,
    );
    expect(raced).toBe(true);
    expect(response.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("AGENDA_AUTHORIZATION_CHANGED");
    expect(afterMutation).toBeDefined();
    expect(await effects()).toEqual(afterMutation);
  });
});
