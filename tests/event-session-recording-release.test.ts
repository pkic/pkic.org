import { recordingAcquisitionObjectKey } from "../functions/_lib/services/event-recordings/acquisitions";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { queue, config, buildId } from "./helpers/site-publication-coordinator";
import {
  claimPublicationDispatch,
  dispatchPublicationAttempt,
} from "../functions/_lib/services/site-publication-coordinator";
import { sessionRecordingPublicUrl } from "../assets/shared/session-recording-public-url";
import { sessionPresentationPublicUrl } from "../assets/shared/session-presentation-public-url";
import { sessionHistoryMetadataSchema, type SessionMaterial } from "../assets/shared/schemas/event-session-history";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";
import {
  sitePublicationDocumentRoutesSchema,
  PUBLICATION_DOCUMENT_ROUTES_PATH,
  type SitePublicationDocumentRoutes,
} from "../assets/shared/schemas/site-publication-release";
import { publicationRecordingAllowSchema } from "../assets/shared/schemas/site-publication-recordings";
import { publicationDocumentStorageKey } from "../assets/shared/schemas/site-publication-documents";
import {
  writePublicationDocumentAllow,
  writePublicationDocumentDenial,
} from "../functions/_lib/services/site-publication-document-projection";
import {
  resolvePublishedRecordings,
  recordPublishedRecordings,
  type PublishedRecording,
} from "../functions/_lib/services/site-publication-recordings";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { requirePresentationBucket } from "../functions/_lib/services/presentation-upload";
import type { Env } from "../functions/_lib/types";
const bytes = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
const snapshotId = "a".repeat(64);
let eventId: string,
  userId: string,
  token: string,
  occurrenceId: string,
  sourceId: string,
  versionId: string,
  url: string;
let material: SessionMaterial, recording: PublishedRecording, artifact: SitePublicationDocumentRoutes | null;
function publicEnvironment(noDb = false): Env {
  const assets = {
    fetch: async (request: Request) =>
      new URL(request.url).pathname === `/${PUBLICATION_DOCUMENT_ROUTES_PATH}` && artifact
        ? Response.json(artifact)
        : new Response(null, { status: 404 }),
  };
  if (noDb)
    return {
      ...env,
      ASSETS: assets,
      SERVICE_MODE: "maintenance",
      get DB(): Env["DB"] {
        throw new Error("Public recording must not access D1");
      },
    };
  return { ...env, ASSETS: assets };
}
async function snapshot(sourceSequence: number | null = 1) {
  return sitePublicationSnapshotSchema.parse({
    version: 1,
    snapshotId,
    sourceSequence,
    eventAgendas: { "pqc-2026": await getAgenda(env.DB, eventId, "pqc-2026") },
    votes: [],
    publicResources: {},
    members: [],
    groups: {},
    groupMembers: {},
    sponsors: {},
    memberWall: [],
    news: [],
    sponsorNews: [],
  });
}
async function activate() {
  await writePublicationDocumentAllow(
    requirePresentationBucket(env),
    publicationRecordingAllowSchema.parse({ ...recording, version: 1 }),
  );
  await env.DB.prepare(
    `INSERT INTO site_publication_recording_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,grant_id) VALUES(?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      `recording-build:${recording.grantId}`,
      snapshotId,
      eventId,
      occurrenceId,
      material.id,
      versionId,
      recording.digest,
      recording.objectEtag,
      recording.grantId,
    )
    .run();
  artifact = sitePublicationDocumentRoutesSchema.parse({
    version: 1,
    snapshotId,
    sourceSequence: 1,
    documents: [{ url, grantId: recording.grantId }],
    redirects: [],
    retiredPaths: [],
  });
}
async function save(changes: Partial<SessionMaterial>) {
  const agenda = await getAgenda(env.DB, eventId, "pqc-2026");
  const history = sessionHistoryMetadataSchema.parse({ materials: [{ ...material, ...changes }] });
  const response = await callApi(
    publicEnvironment(),
    `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/history`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: agenda.revision, history }),
    },
  );
  const row = await env.DB.prepare("SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?")
    .bind(occurrenceId)
    .first<{ metadata_json: string }>();
  material = sessionHistoryMetadataSchema.parse(JSON.parse(row!.metadata_json)).materials[0]!;
  return response;
}
async function completeOwnedVersion(
  selectedVersionId: string,
  versionNumber: number,
  metadataRevision: number,
  content: Uint8Array,
  contentDigest: string,
  objectKey: string,
  objectEtag: string,
  now: string,
  acquisitionId: string,
) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO event_recording_acquisitions(id,event_id,source_id,operation_id,payload_hash,expected_metadata_revision,requested_by_user_id,status,next_attempt_at,completed_version_id,completed_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'completed',?,?,?,?,?)`,
    ).bind(
      acquisitionId,
      eventId,
      sourceId,
      crypto.randomUUID(),
      "f".repeat(64),
      metadataRevision,
      userId,
      now,
      selectedVersionId,
      now,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO event_recording_versions(id,event_id,source_id,acquisition_id,version_number,source_metadata_revision,r2_key,digest,file_size,mime_type,object_etag,acquired_at)
      VALUES(?,?,?,?,?,?,?,?,?,'video/mp4',?,?)`,
    ).bind(
      selectedVersionId,
      eventId,
      sourceId,
      acquisitionId,
      versionNumber,
      metadataRevision,
      objectKey,
      contentDigest,
      content.length,
      objectEtag,
      now,
    ),
  ]);
}

beforeEach(async () => {
  await resetDb();
  artifact = null;
  eventId = await queue();
  userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
  token = await createAdminSession(env.DB, userId, crypto.randomUUID());
  occurrenceId = crypto.randomUUID();
  sourceId = crypto.randomUUID();
  versionId = crypto.randomUUID();
  const now = new Date().toISOString(),
    acquisitionId = crypto.randomUUID(),
    r2Key = recordingAcquisitionObjectKey({ acquisition: { eventId, sourceId, id: acquisitionId } }, versionId);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,title,description) VALUES(?,?,'Recording session','')",
  )
    .bind(occurrenceId, eventId)
    .run();
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId, providerAccountId: "0".repeat(32), now });
  await env.DB.prepare(
    `INSERT INTO event_recording_sources(id,event_id,meeting_link_id,provider_type,provider_account_id,provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,provider_status,provider_invoked_at,provider_started_at,provider_file_size,metadata_revision,observed_at,created_by_user_id,created_at,updated_at)
    VALUES(?,?,?,'realtimekit',?,?,?,?,?,'UPLOADED',?,?,?,1,?,?,?,?)`,
  )
    .bind(
      sourceId,
      eventId,
      meeting.meetingLinkId,
      meeting.providerAccountId,
      meeting.providerAppId,
      meeting.providerMeetingId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      now,
      now,
      bytes.length,
      now,
      userId,
      now,
      now,
    )
    .run();
  const object = await requirePresentationBucket(env).put(r2Key, bytes);
  if (!object) throw new Error("Expected owned recording bytes");
  await completeOwnedVersion(versionId, 1, 1, bytes, digest, r2Key, object.etag, now, acquisitionId);
  url = sessionRecordingPublicUrl({
    eventSlug: "pqc-2026",
    occurrenceId,
    materialId: "owned-video",
    versionId,
    digest,
  });
  material = sessionHistoryMetadataSchema.parse({
    materials: [
      {
        id: "owned-video",
        kind: "recording",
        title: "Recording",
        url,
        presentationVersionId: null,
        recordingVersionId: versionId,
        version: 1,
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
        status: "approved",
        approvedAt: now,
        approvalNonce: crypto.randomUUID(),
      },
    ],
  }).materials[0]!;
  await env.DB.prepare(
    "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
  )
    .bind(occurrenceId, JSON.stringify({ materials: [material] }), userId, now)
    .run();
  recording = (await resolvePublishedRecordings(env.DB, await snapshot()))[0]!;
  expect(recording).toBeDefined();
});
describe("Immutable selected recording gateway", () => {
  it("serves cold exact bytes without database/auth even during maintenance", async () => {
    expect((await callApi(publicEnvironment(true), url)).status).toBe(404);
    await activate();
    const response = await callApi(publicEnvironment(true), url, {
      headers: { cookie: "session=invalid", authorization: "Bearer invalid" },
    });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBe(`"${recording.digest}"`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(JSON.stringify(artifact)).not.toContain(recording.r2Key);
    const pdfUrl = sessionPresentationPublicUrl({
      eventSlug: "pqc-2026",
      occurrenceId,
      versionId,
      digest: recording.digest,
    });
    artifact!.documents.push({ url: pdfUrl, grantId: recording.grantId });
    expect((await callApi(publicEnvironment(true), pdfUrl)).status).toBe(404);
  });
  it("preserves GET/HEAD/range/conditional semantics without public caching", async () => {
    await activate();
    const environment = publicEnvironment(true);
    const head = await callApi(environment, url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe("16");
    for (const [range, start, end] of [
      ["bytes=4-7", 4, 8],
      ["bytes=-4", 12, 16],
      ["bytes=12-", 12, 16],
    ] as const) {
      const response = await callApi(environment, url, { headers: { range } });
      expect(response.status).toBe(206);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.subarray(start, end));
      expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end - 1}/16`);
    }
    const invalid = await callApi(environment, url, { headers: { range: "bytes=16-" } });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */16");
    const conditional = await callApi(environment, url, { headers: { "if-none-match": `W/"${recording.digest}"` } });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("cache-control")).toBe("no-store");
    expect(
      (await callApi(environment, url, { headers: { range: "bytes=4-7", "if-range": "different-version" } })).status,
    ).toBe(200);
    expect((await callApi(environment, url, { method: "POST" })).status).toBe(405);
    expect((await callApi(environment, `${url}?provider=secret`)).status).toBe(404);
  });
  it("refuses another material/version, changed stored bytes and missing activated selection", async () => {
    await activate();
    const environment = publicEnvironment(true);
    expect((await callApi(environment, url.replace("owned-video", "other-material"))).status).toBe(404);
    expect((await callApi(environment, url.replace(versionId, crypto.randomUUID()))).status).toBe(404);
    artifact!.documents = [];
    expect((await callApi(environment, url)).status).toBe(404);
    artifact!.documents = [{ url, grantId: recording.grantId }];
    await requirePresentationBucket(env).put(recording.r2Key, new Uint8Array(bytes.length));
    expect((await callApi(environment, url)).status).toBe(404);
  });
  it.each(["withdrawn", "draft"] as const)(
    "terminally denies a %s release through actual history mutation",
    async (status) => {
      await activate();
      const old = recording;
      expect((await save({ status })).status).toBe(200);
      expect(
        (await callApi(publicEnvironment(true), url, { headers: { "if-none-match": `"${old.digest}"` } })).status,
      ).toBe(404);
      await expect(
        writePublicationDocumentAllow(
          requirePresentationBucket(env),
          publicationRecordingAllowSchema.parse({ ...old, version: 1 }),
        ),
      ).rejects.toThrow("PUBLICATION_DOCUMENT_DENIED");
      expect(
        await requirePresentationBucket(env).head(publicationDocumentStorageKey(old.grantId, "deny")),
      ).not.toBeNull();
    },
  );
  it("replacing the explicit selected version terminally retires the old release and serves only the new bytes", async () => {
    await activate();
    const old = recording,
      oldUrl = url;
    const replacement = new Uint8Array([...bytes, 0, 0, 0, 8, 109, 100, 97, 116]),
      nextId = crypto.randomUUID(),
      now = new Date().toISOString();
    const nextDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", replacement)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await env.DB.prepare("UPDATE event_recording_sources SET provider_file_size=?,metadata_revision=2 WHERE id=?")
      .bind(replacement.length, sourceId)
      .run();
    const acquisitionId = crypto.randomUUID(),
      key = recordingAcquisitionObjectKey({ acquisition: { eventId, sourceId, id: acquisitionId } }, nextId),
      object = await requirePresentationBucket(env).put(key, replacement);
    if (!object) throw new Error("Expected replacement bytes");
    await completeOwnedVersion(nextId, 2, 2, replacement, nextDigest, key, object.etag, now, acquisitionId);
    expect((await save({ recordingVersionId: nextId, version: 2, url: "" })).status).toBe(200);
    expect((await callApi(publicEnvironment(true), oldUrl)).status).toBe(404);
    await expect(
      writePublicationDocumentAllow(
        requirePresentationBucket(env),
        publicationRecordingAllowSchema.parse({ ...old, version: 1 }),
      ),
    ).rejects.toThrow("PUBLICATION_DOCUMENT_DENIED");
    recording = (await resolvePublishedRecordings(env.DB, await snapshot()))[0]!;
    versionId = nextId;
    url = material.url;
    await activate();
    const response = await callApi(publicEnvironment(true), url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(replacement);
    expect((await callApi(publicEnvironment(true), oldUrl)).status).toBe(404);
  });
  it("a terminal denial defeats a retained immutable artifact and late allow", async () => {
    await activate();
    await writePublicationDocumentDenial(requirePresentationBucket(env), {
      kind: "recording",
      eventId,
      eventSlug: recording.eventSlug,
      occurrenceId,
      materialId: recording.materialId,
      versionId,
      digest: recording.digest,
      grantId: recording.grantId,
    });
    expect((await callApi(publicEnvironment(true), url)).status).toBe(404);
    await expect(
      writePublicationDocumentAllow(
        requirePresentationBucket(env),
        publicationRecordingAllowSchema.parse({ ...recording, version: 1 }),
      ),
    ).rejects.toThrow("PUBLICATION_DOCUMENT_DENIED");
  });
});
async function machine() {
  const attempt = (await claimPublicationDispatch(env.DB, config))!;
  await dispatchPublicationAttempt(env.DB, attempt, "synthetic-token", async () =>
    Response.json({ success: true, result: { build_uuid: buildId } }),
  );
  await env.DB.prepare("UPDATE site_publication_provider_attempts SET phase='build_attested' WHERE id=?")
    .bind(attempt.id)
    .run();
  return {
    attempt,
    machineEnv: {
      CLOUDFLARE_ENV: "production",
      SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify(config),
      WORKERS_CI_BUILD_UUID: buildId,
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: config.provider.commitHash,
      PKIC_PUBLICATION_ATTEMPT_ID: attempt.id,
    },
  };
}
describe("Recording manifest binding", () => {
  it("captures one exact immutable coordinator selection, retries without duplicates and refuses substituted facts", async () => {
    const { attempt, machineEnv } = await machine(),
      source = await snapshot(attempt.sourceSequence);
    await recordPublishedRecordings(env.DB, source, [recording], machineEnv);
    await recordPublishedRecordings(env.DB, source, [recording], machineEnv);
    const rows = await env.DB.prepare(
      "SELECT build_id,version_id,digest,object_etag,grant_id FROM site_publication_recording_manifests",
    ).all();
    expect(rows.results).toEqual([
      {
        build_id: buildId,
        version_id: versionId,
        digest: recording.digest,
        object_etag: recording.objectEtag,
        grant_id: recording.grantId,
      },
    ]);
    await expect(
      recordPublishedRecordings(env.DB, source, [{ ...recording, objectEtag: "substituted" }], machineEnv),
    ).rejects.toThrow("approved snapshot");
    await expect(
      recordPublishedRecordings(env.DB, source, [{ ...recording, mimeType: "video/webm" }], machineEnv),
    ).rejects.toThrow("approved snapshot");
  });
  it.each(["source", "version", "material", "acquisition", "fence"])(
    "atomically refuses a %s change after extraction preflight",
    async (change) => {
      const { attempt, machineEnv } = await machine(),
        source = await snapshot(attempt.sourceSequence);
      const raced = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "source")
          await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?")
            .bind(new Date().toISOString(), sourceId)
            .run();
        if (change === "version")
          await env.DB.prepare("UPDATE event_recording_versions SET deleted_at=? WHERE id=?")
            .bind(new Date().toISOString(), versionId)
            .run();
        if (change === "material")
          await env.DB.prepare("UPDATE event_agenda_session_history SET metadata_json=? WHERE occurrence_id=?")
            .bind(JSON.stringify({ materials: [{ ...material, status: "withdrawn" }] }), occurrenceId)
            .run();
        if (change === "acquisition")
          await env.DB.prepare("UPDATE event_recording_acquisitions SET status='failed' WHERE completed_version_id=?")
            .bind(versionId)
            .run();
        if (change === "fence")
          await env.DB.prepare(
            "UPDATE site_publication_pipeline_fence SET lease_token='different-owner' WHERE id=1",
          ).run();
      });
      await expect(recordPublishedRecordings(raced, source, [recording], machineEnv)).rejects.toThrow();
      expect(
        (await env.DB.prepare("SELECT version_id FROM site_publication_recording_manifests").all()).results,
      ).toEqual([]);
    },
  );
  it("refuses stale version/source/approval before extraction and does not invent a newest version", async () => {
    const source = await snapshot();
    await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?")
      .bind(new Date().toISOString(), sourceId)
      .run();
    await expect(resolvePublishedRecordings(env.DB, source)).rejects.toThrow("authority changed");
    await expect(recordPublishedRecordings(env.DB, source, [recording], {})).rejects.toThrow(
      "attested native publication coordinator",
    );
  });
});
