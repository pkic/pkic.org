import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { sessionHistoryMetadataSchema, sessionMaterialSchema } from "../assets/shared/schemas/event-session-history";
import { transferPrepareSchema } from "../assets/shared/schemas/event-agenda-transfer";
import {
  parseSessionRecordingPublicUrl,
  sessionRecordingPublicUrl,
} from "../assets/shared/session-recording-public-url";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { transferredSessionHistory } from "../functions/_lib/services/event-agenda/transfer-history";
import type { DatabaseLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";

async function acquiredVersion(eventId: string, userId: string, mimeType = "video/mp4") {
  const sourceId = crypto.randomUUID(),
    acquisitionId = crypto.randomUUID(),
    versionId = crypto.randomUUID();
  const now = new Date().toISOString(),
    digest = "a".repeat(64);
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId, now });
  await env.DB.prepare(
    `INSERT INTO event_recording_sources
    (id,event_id,meeting_link_id,provider_type,provider_account_id,provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,
    provider_status,provider_invoked_at,provider_started_at,provider_file_size,metadata_revision,observed_at,created_by_user_id,created_at,updated_at)
    VALUES(?,?,?,'realtimekit',?,'synthetic-app',?,?,?,'UPLOADED',?,?,128,1,?,?,?,?)`,
  )
    .bind(
      sourceId,
      eventId,
      meeting.meetingLinkId,
      meeting.providerAccountId,
      meeting.providerMeetingId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      now,
      now,
      now,
      userId,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO event_recording_acquisitions
    (id,event_id,source_id,operation_id,payload_hash,expected_metadata_revision,requested_by_user_id,status,next_attempt_at,created_at,updated_at)
    VALUES(?,?,?,?,?,1,?,'queued',?,?,?)`,
  )
    .bind(acquisitionId, eventId, sourceId, crypto.randomUUID(), "b".repeat(64), userId, now, now, now)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO event_recording_versions
      (id,event_id,source_id,acquisition_id,version_number,source_metadata_revision,r2_key,digest,file_size,mime_type,object_etag,acquired_at)
      VALUES(?,?,?,?,1,1,?,?,128,?,?,?)`,
    ).bind(
      versionId,
      eventId,
      sourceId,
      acquisitionId,
      `event-recordings/${eventId}/${sourceId}/${versionId}`,
      digest,
      mimeType,
      "synthetic-owned-etag",
      now,
    ),
    env.DB.prepare(
      "UPDATE event_recording_acquisitions SET status='completed',completed_version_id=?,completed_at=? WHERE id=?",
    ).bind(versionId, now, acquisitionId),
  ]);
  return { sourceId, acquisitionId, versionId, digest, now };
}

async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const agenda = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Owned recording",
      startAt: null,
      endAt: null,
      roomId: null,
      speakerUserIds: [],
    }),
    admin.id,
  );
  const occurrenceId = agenda.occurrences[0]!.id;
  const version = await acquiredVersion(eventId, admin.id);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const history = sessionHistoryMetadataSchema.parse({
    materials: [
      {
        id: "recording / original",
        kind: "recording",
        title: "Reviewed recording",
        url: "",
        presentationVersionId: null,
        recordingVersionId: version.versionId,
        version: 1,
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
        status: "approved",
        approvedAt: "2024-01-01T00:00:00.000Z",
      },
    ],
  });
  const save = (expectedRevision = 1, input = history, db: DatabaseLike = env.DB) =>
    callApi({ ...env, DB: db }, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/history`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision, history: input }),
    });
  return { eventId, userId: admin.id, occurrenceId, history, save, ...version };
}

async function effects() {
  return Promise.all(
    [
      "SELECT event_id,revision,updated_at FROM event_agenda_state ORDER BY event_id",
      "SELECT occurrence_id,metadata_json,updated_by,updated_at FROM event_agenda_session_history ORDER BY occurrence_id",
      "SELECT id,presentation_url,recording_url FROM event_agenda_occurrences ORDER BY id",
      "SELECT id,actor_id,action,details_json FROM audit_log ORDER BY id",
      "SELECT id,resource_id,revision,reason_code,status FROM site_publication_requests ORDER BY id",
      "SELECT id,template_key,status,payload_json FROM email_outbox ORDER BY id",
      "SELECT id,valid FROM session_presentation_write_guards ORDER BY id",
    ].map(async (sql) => (await env.DB.prepare(sql).all()).results),
  );
}

describe("Explicit owned recording material binding", () => {
  beforeEach(async () => resetDb());

  it("normalizes the selected version before approval and retains its exact receipt on unchanged selection", async () => {
    const f = await fixture();
    const response = await f.save();
    expect(response.status, await response.clone().text()).toBe(200);
    const first = agendaSnapshotSchema.parse(await response.json());
    const material = first.occurrences[0]!.history!.materials[0]!;
    const path = sessionRecordingPublicUrl({
      eventSlug: "pqc-2026",
      occurrenceId: f.occurrenceId,
      materialId: material.id,
      versionId: f.versionId,
      digest: f.digest,
    });
    expect(material.url).toBe(path);
    expect(parseSessionRecordingPublicUrl(path)).toEqual({
      eventSlug: "pqc-2026",
      occurrenceId: f.occurrenceId,
      materialId: material.id,
      versionId: f.versionId,
      digest: f.digest,
    });
    expect(material.approvedAt).not.toBe(f.history.materials[0]!.approvedAt);
    expect(material.approvalNonce).toEqual(expect.any(String));
    expect(first.occurrences[0]!.recordingUrl).toBe(path);
    // A later provider observation is not a replacement of already acquired, selected bytes.
    await env.DB.prepare(
      "UPDATE event_recording_sources SET metadata_revision=metadata_revision+1,provider_status='UPLOADING' WHERE id=?",
    )
      .bind(f.sourceId)
      .run();
    const again = sessionHistoryMetadataSchema.parse({
      ...first.occurrences[0]!.history,
      materials: [
        {
          ...material,
          title: "Editorial title correction",
          url: "",
          approvedAt: "2025-01-01T00:00:00.000Z",
          approvalNonce: crypto.randomUUID(),
        },
      ],
    });
    const secondResponse = await f.save(2, again);
    expect(secondResponse.status, await secondResponse.clone().text()).toBe(200);
    const second = agendaSnapshotSchema.parse(await secondResponse.json()).occurrences[0]!.history!.materials[0]!;
    expect(second).toEqual({ ...material, title: "Editorial title correction" });
    expect(
      (await env.DB.prepare("SELECT id FROM site_publication_requests WHERE resource_type='session_material'").all())
        .results,
    ).toEqual([]);
    expect(JSON.stringify(second)).not.toContain("event-recordings/");
    expect(JSON.stringify(second)).not.toContain("synthetic-owned-etag");
  });

  it.each([
    "foreign event",
    "missing",
    "deleted",
    "disabled source",
    "stale version",
    "unsupported MIME",
    "rights",
    "consent",
    "validation",
  ] as const)("refuses %s without history, revision or delivery effects", async (change) => {
    const f = await fixture();
    let history = f.history;
    if (change === "foreign event") {
      const eventId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,settings_json,created_at,updated_at) VALUES(?,'foreign-recording','Other event','UTC',?,?, '{}',?,?)",
      )
        .bind(eventId, "2026-12-01T09:00:00.000Z", "2026-12-03T17:00:00.000Z", f.now, f.now)
        .run();
      const foreign = await acquiredVersion(eventId, f.userId);
      history = sessionHistoryMetadataSchema.parse({
        ...history,
        materials: [{ ...history.materials[0], recordingVersionId: foreign.versionId }],
      });
    } else if (
      change === "missing" ||
      change === "stale version" ||
      change === "rights" ||
      change === "consent" ||
      change === "validation"
    ) {
      const patch =
        change === "missing"
          ? { recordingVersionId: crypto.randomUUID() }
          : change === "stale version"
            ? { version: 2 }
            : {
                [change === "rights" ? "rightsConfirmed" : change === "consent" ? "consentConfirmed" : "validated"]:
                  false,
              };
      history = sessionHistoryMetadataSchema.parse({ ...history, materials: [{ ...history.materials[0], ...patch }] });
    } else if (change === "unsupported MIME") {
      const unsupported = await acquiredVersion(f.eventId, f.userId, "application/pdf");
      history = sessionHistoryMetadataSchema.parse({
        ...history,
        materials: [{ ...history.materials[0], recordingVersionId: unsupported.versionId }],
      });
    } else {
      const sql =
        change === "deleted"
          ? "UPDATE event_recording_versions SET deleted_at=? WHERE id=?"
          : "UPDATE event_recording_sources SET disabled_at=? WHERE id=?";
      await env.DB.prepare(sql)
        .bind(f.now, change === "deleted" ? f.versionId : f.sourceId)
        .run();
    }
    const before = await effects();
    const response = await f.save(1, history);
    expect(response.status, await response.clone().text()).toBe(400);
    expect(await effects()).toEqual(before);
  });

  it.each(["deleted", "disabled source"] as const)(
    "rolls back the full correction if %s changes after preflight",
    async (change) => {
      const f = await fixture();
      let authoritative = await effects(),
        armed = false;
      const raced = mutateBeforeNextBatch(env.DB, async () => {
        await env.DB.prepare(
          change === "deleted"
            ? "UPDATE event_recording_versions SET deleted_at=? WHERE id=?"
            : "UPDATE event_recording_sources SET disabled_at=? WHERE id=?",
        )
          .bind(f.now, change === "deleted" ? f.versionId : f.sourceId)
          .run();
        authoritative = await effects();
      });
      const db: DatabaseLike = {
        prepare(sql) {
          if (sql.startsWith("INSERT INTO session_presentation_write_guards")) armed = true;
          return env.DB.prepare(sql);
        },
        batch: (statements) => (armed ? raced : env.DB).batch(statements),
      };
      const response = await f.save(1, f.history, db);
      expect(response.status, await response.clone().text()).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "MATERIAL_VERSION_CHANGED" } });
      expect(await effects()).toEqual(authoritative);
    },
  );

  it("refuses a stale agenda correction without replacing the approved recording receipt", async () => {
    const f = await fixture();
    const saved = await f.save();
    expect(saved.status, await saved.clone().text()).toBe(200);
    const current = agendaSnapshotSchema.parse(await saved.json());
    const before = await effects();
    const response = await f.save(1, current.occurrences[0]!.history!);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_REVISION_CHANGED" } });
    expect(await effects()).toEqual(before);
  });

  it("keeps raw historical materials additive and forbids recording/presentation binding substitution", async () => {
    const f = await fixture();
    const { recordingVersionId: _binding, ...old } = f.history.materials[0]!;
    expect(
      sessionMaterialSchema.parse({ ...old, url: "https://example.test/recording" }).recordingVersionId,
    ).toBeNull();
    expect(sessionMaterialSchema.safeParse({ ...f.history.materials[0], kind: "presentation" }).success).toBe(false);
    expect(
      sessionMaterialSchema.safeParse({ ...f.history.materials[0], presentationVersionId: crypto.randomUUID() })
        .success,
    ).toBe(false);
    expect(sessionMaterialSchema.safeParse({ ...f.history.materials[0], id: "x".repeat(301) }).success).toBe(false);
    const url = sessionRecordingPublicUrl({
      eventSlug: "pqc-2026",
      occurrenceId: f.occurrenceId,
      materialId: f.history.materials[0]!.id,
      versionId: f.versionId,
      digest: f.digest,
    });
    expect(sessionMaterialSchema.safeParse({ ...f.history.materials[0], id: "another-material", url }).success).toBe(
      false,
    );
    expect(parseSessionRecordingPublicUrl(`${url}?token=secret`)).toBeNull();
  });

  it.each(["archive", "copy_as_new"] as const)(
    "clears selected owned versions and approval when transferring as %s",
    async (mode) => {
      const f = await fixture();
      const response = await f.save();
      expect(response.status, await response.clone().text()).toBe(200);
      const saved = agendaSnapshotSchema.parse(await response.json()).occurrences[0]!.history!;
      const input = transferPrepareSchema.parse({
        expectedRevision: 0,
        mode,
        resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
        document: {
          format: "pkic-agenda",
          version: 1,
          source: { kind: "portable", eventRef: "source", exportedAt: f.now, sourceDigest: f.digest },
          rooms: [],
          people: [],
          occurrences: [
            {
              ref: "recorded",
              sourceKey: "recorded",
              sourcePath: "/events/source/",
              fields: { title: "Recorded session" },
              timing: {
                timeZone: "UTC",
                authoredDate: null,
                authoredStart: null,
                startAt: null,
                endAt: null,
                endSource: "unresolved",
                transitionMinutes: 0,
                transitionSource: "none",
              },
              roomRefs: [],
              personRefs: [],
              media: [
                {
                  kind: "recording",
                  authoredReference: "recording",
                  publicUrl: "https://example.test/candidate",
                  sourceDigest: null,
                },
              ],
              archive: saved,
              sourceAnchor: null,
              retainedSourceEvidence: [],
            },
          ],
        },
      });
      const transferred = transferredSessionHistory(input, input.document.occurrences[0]!);
      expect(transferred!.materials[0]).toMatchObject({
        url: "https://example.test/candidate",
        recordingVersionId: null,
        presentationVersionId: null,
        rightsConfirmed: false,
        consentConfirmed: false,
        validated: false,
        status: "draft",
        approvedAt: null,
        approvalNonce: null,
      });
      const originalOnly = transferPrepareSchema.parse({
        ...input,
        document: {
          ...input.document,
          occurrences: [
            {
              ...input.document.occurrences[0]!,
              media: [],
              fields: { ...input.document.occurrences[0]!.fields, recordingUrl: saved.materials[0]!.url },
            },
          ],
        },
      });
      expect(transferredSessionHistory(originalOnly, originalOnly.document.occurrences[0]!)!.materials).toEqual([]);
    },
  );
});
