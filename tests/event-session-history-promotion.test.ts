import { projectLiveAgendaMaterials } from "../functions/_lib/services/site-agenda-material-eligibility";
import { saveSessionHistory, listSessionMaterialVersions } from "../functions/_lib/services/event-agenda/history";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { agendaOccurrenceCreateSchema } from "../assets/shared/schemas/event-agenda";
import {
  sessionMaterialVersionsQuerySchema,
  sessionHistoryMetadataSchema,
} from "../assets/shared/schemas/event-session-history";
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { agendaSnapshotSchema, type AgendaSnapshot } from "../assets/shared/schemas/event-agenda";
import {
  assignedPromotionKit,
  listAssignedPromotionSessions,
} from "../functions/_lib/services/event-agenda/promotion-access";
import {
  requestPromotionRender,
  processPromotionRenderJob,
} from "../functions/_lib/services/event-agenda/promotion-render-jobs";
import { agendaOccurrenceQuerySchema } from "../assets/shared/schemas/event-agenda";
import { requirePresentationBucket } from "../functions/_lib/services/presentation-upload";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import type { DatabaseLike } from "../functions/_lib/types";
import { sessionPresentationPublicUrl } from "../assets/shared/session-presentation-public-url";
import { publicAgendaProjection } from "../functions/_lib/services/event-agenda/public-projection";
import { agendaContent } from "../assets/shared/public-agenda-content";

async function legacyPdfFixture(proven = true) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const admin = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!;
  const agenda = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Historical PDF",
      startAt: null,
      endAt: null,
      roomId: null,
      speakerUserIds: [],
    }),
  );
  const occurrenceId = agenda.occurrences[0]!.id,
    versionId = crypto.randomUUID(),
    now = new Date().toISOString();
  const pdf = "%PDF-1.7\nSynthetic original PDF\n%%EOF",
    digest = await sha256Hex(pdf),
    key = `session-presentations/${eventId}/${occurrenceId}/${versionId}`;
  await requirePresentationBucket(env).put(key, pdf);
  await env.DB.prepare(
    "INSERT INTO session_presentation_versions(id,event_id,occurrence_id,version_number,r2_key,file_name,file_size,mime_type,source_digest,uploaded_by_user_id,uploaded_at) VALUES(?,?,?,1,?,'Original.pdf',?,'application/pdf',?,?,?)",
  )
    .bind(versionId, eventId, occurrenceId, key, pdf.length, digest, admin.id, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO session_presentation_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,'approved')",
  )
    .bind(crypto.randomUUID(), versionId, admin.id, now)
    .run();
  const receipt = {
    url: "/events/pqc-2026/Original%20Slides.pdf",
    targetUrl: "/content-media/events/pqc-2026/Original%20Slides.pdf",
    sourcePath: "content/events/pqc-2026/agenda.md",
    sourceDigest: "a".repeat(64),
    sourceLocator: "days[0].sessions[0]",
    ...(proven ? { pdfDigest: digest, pdfBytes: pdf.length } : {}),
  };
  await env.DB.prepare(
    "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
  )
    .bind(occurrenceId, JSON.stringify({ legacyDownloads: [receipt] }), admin.id, now)
    .run();
  const history = sessionHistoryMetadataSchema.parse({
    legacyDownloads: [receipt],
    materials: [
      {
        id: "slides",
        kind: "presentation",
        title: "Original PDF",
        url: "",
        presentationSource: "session",
        presentationVersionId: versionId,
        version: 1,
        legacyDownloadUrl: receipt.url,
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
        status: "approved",
        approvedAt: now,
      },
    ],
  });
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const save = (input = history, db: DatabaseLike = env.DB) =>
    callApi({ ...env, DB: db }, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/history`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, history: input }),
    });
  return { eventId, occurrenceId, versionId, adminId: admin.id, digest, now, history, save };
}
async function pdfBindingEffects() {
  return Promise.all(
    [
      "SELECT event_id,revision,updated_at FROM event_agenda_state ORDER BY event_id",
      "SELECT occurrence_id,metadata_json,updated_by,updated_at FROM event_agenda_session_history ORDER BY occurrence_id",
      "SELECT id,presentation_url,recording_url FROM event_agenda_occurrences ORDER BY id",
      "SELECT id,actor_id,action,details_json FROM audit_log ORDER BY id",
      "SELECT id,resource_id,revision,reason_code,status FROM site_publication_requests ORDER BY id",
      "SELECT id,template_key,status,payload_json FROM email_outbox ORDER BY id",
    ].map(async (sql) => (await env.DB.prepare(sql).all()).results),
  );
}
describe("session archive and promotion publication", () => {
  beforeEach(async () => resetDb());
  it("releases reviewed recording/companions and retires removed media without a raw URL fallback", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin!.id, "recording-release");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const agenda = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Recorded session",
        description: "A substantive archive of a reviewed session about certificate lifecycle.",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
        speakerUserIds: [],
        presentationUrl: "/draft-slides.pdf",
        recordingUrl: "https://example.test/draft-recording",
      }),
    );
    const occurrenceId = agenda.occurrences[0]!.id;
    const content = (snapshot: AgendaSnapshot) =>
      agendaContent(publicAgendaProjection(snapshot, null)).days[0]!.slots[0]!.sessions[0]!;
    expect(content(agenda).presentationUrl).toBeUndefined();
    expect(content(agenda).recordingUrl).toBeUndefined();
    const archiveUrl = content(agenda).sessionUrl;
    const save = async (expectedRevision: number, history: unknown) =>
      callApi(env, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/history`, {
        method: "POST",
        headers,
        body: JSON.stringify({ expectedRevision, history }),
      });
    const metadata = sessionHistoryMetadataSchema.parse({
      materials: ["presentation", "recording", "captions", "transcript"].map((kind) => ({
        id: kind,
        kind,
        title: `Reviewed ${kind}`,
        url: kind === "recording" ? "https://www.youtube.com/watch?v=AbCdEf12345&start=90" : `/materials/${kind}.v1`,
        presentationVersionId: null,
        version: 1,
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
        status: "approved",
        approvedAt: "2026-10-03T00:00:00.000Z",
      })),
    });
    const invalid = await save(1, { ...metadata, materials: [{ ...metadata.materials[1], rightsConfirmed: false }] });
    expect(invalid.status).toBe(400);
    const response = await save(1, metadata);
    expect(response.status, await response.clone().text()).toBe(200);
    const released = agendaSnapshotSchema.parse(await response.json());
    const priorMaterials = structuredClone(released.occurrences[0]!.history!.materials);
    expect(priorMaterials).toHaveLength(metadata.materials.length);
    for (const [index, material] of priorMaterials.entries()) {
      expect(material.approvedAt).toEqual(expect.any(String));
      expect(material.approvedAt).not.toBe(metadata.materials[index]!.approvedAt);
      expect(material.approvalNonce).toEqual(expect.any(String));
      expect(material).toEqual({
        ...metadata.materials[index],
        approvedAt: material.approvedAt,
        approvalNonce: material.approvalNonce,
      });
    }
    const live = await projectLiveAgendaMaterials(env.DB, eventId, released);
    expect(live.occurrences[0]!.history!.materials.map((material) => material.kind)).toEqual([
      "presentation",
      "recording",
      "captions",
      "transcript",
    ]);
    expect(content(live)).toMatchObject({
      sessionUrl: archiveUrl,
      presentationUrl: "/materials/presentation.v1",
      recordingUrl: "https://www.youtube.com/watch?v=AbCdEf12345&start=90",
    });
    const updatedVersion = await save(2, {
      ...metadata,
      materials: metadata.materials.map((material) =>
        material.kind === "recording" ? { ...material, version: 2 } : material,
      ),
    });
    expect(updatedVersion.status).toBe(200);
    const updated = agendaSnapshotSchema.parse(await updatedVersion.json());
    const updatedMaterials = updated.occurrences[0]!.history!.materials;
    expect(updatedMaterials.filter((material) => material.kind !== "recording")).toEqual(
      priorMaterials.filter((material) => material.kind !== "recording"),
    );
    const updatedRecording = updatedMaterials.find((material) => material.kind === "recording")!;
    const priorRecording = priorMaterials.find((material) => material.kind === "recording")!;
    expect(updatedRecording.approvalNonce).not.toBe(priorRecording.approvalNonce);
    const superseded = await projectLiveAgendaMaterials(env.DB, eventId, released);
    expect(superseded.occurrences[0]!.history!.materials.map((material) => material.kind)).toEqual([
      "presentation",
      "captions",
      "transcript",
    ]);
    expect(content(superseded).recordingUrl).toBeUndefined();
    const removedResponse = await save(3, { ...metadata, materials: [] });
    expect(removedResponse.status).toBe(200);
    const removed = agendaSnapshotSchema.parse(await removedResponse.json());
    expect(removed.occurrences[0]).toMatchObject({ presentationUrl: null, recordingUrl: null });
    expect(content(removed)).toMatchObject({ sessionUrl: archiveUrl });
    const rebuilt = await projectLiveAgendaMaterials(env.DB, eventId, released);
    expect(rebuilt.occurrences[0]!.history!.materials).toEqual([]);
    expect(content(rebuilt).presentationUrl).toBeUndefined();
    expect(content(rebuilt).recordingUrl).toBeUndefined();
    expect(released.occurrences[0]!.history!.materials).toEqual(priorMaterials);
    expect(
      await queryAll(
        env.DB,
        "SELECT revision,reason_code,status FROM site_publication_requests WHERE resource_type='session_material' AND resource_id=? ORDER BY revision",
        occurrenceId,
      ),
    ).toEqual([
      { revision: 3, reason_code: "rights_withdrawn", status: "queued" },
      { revision: 4, reason_code: "rights_withdrawn", status: "queued" },
    ]);
    const effects = await pdfBindingEffects();
    expect((await save(3, metadata)).status).toBe(409);
    expect(await pdfBindingEffects()).toEqual(effects);
  });
  it("binds an explicitly selected original URL to the independently proven uploaded PDF bytes", async () => {
    const fixture = await legacyPdfFixture();
    const response = await fixture.save();
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = agendaSnapshotSchema.parse(await response.json());
    const history = saved.occurrences[0]!.history!;
    expect(history.materials[0]!.legacyDownloadUrl).toBe(fixture.history.legacyDownloads[0]!.url);
    expect(history.materials[0]!.url).toBe(
      sessionPresentationPublicUrl({
        eventSlug: "pqc-2026",
        occurrenceId: fixture.occurrenceId,
        versionId: fixture.versionId,
        digest: fixture.digest,
      }),
    );
    expect(history.legacyDownloads[0]).toMatchObject({ sourceDigest: "a".repeat(64), pdfDigest: fixture.digest });
    expect(history.legacyDownloads[0]!.sourceDigest).not.toBe(history.legacyDownloads[0]!.pdfDigest);
    expect(saved.revision).toBe(2);
  });
  it("normalizes missing additive receipt fields without authorizing unknown evidence or ordinary enrichment", async () => {
    const fixture = await legacyPdfFixture(false),
      before = await pdfBindingEffects();
    const refused = await fixture.save();
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "MATERIAL_LEGACY_DOWNLOAD_UNVERIFIED" } });
    const enriched = sessionHistoryMetadataSchema.parse({
      ...fixture.history,
      legacyDownloads: fixture.history.legacyDownloads.map((receipt) => ({
        ...receipt,
        pdfDigest: fixture.digest,
        pdfBytes: 42,
      })),
    });
    expect((await fixture.save(enriched)).status).toBe(400);
    expect(await pdfBindingEffects()).toEqual(before);
    const unbound = sessionHistoryMetadataSchema.parse({
      ...fixture.history,
      materials: fixture.history.materials.map((material) => ({ ...material, legacyDownloadUrl: null })),
    });
    expect((await fixture.save(unbound)).status).toBe(200);
    expect(
      (await env.DB.prepare("SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?")
        .bind(fixture.occurrenceId)
        .first<{ metadata_json: string }>())!.metadata_json,
    ).toContain('"pdfDigest":null');
  });
  it.each(["digest", "bytes", "mime", "owner", "version", "review", "rights", "consent"] as const)(
    "refuses unavailable or mismatched %s before binding a historical URL",
    async (change) => {
      const fixture = await legacyPdfFixture();
      let input = fixture.history;
      if (change === "rights" || change === "consent")
        input = sessionHistoryMetadataSchema.parse({
          ...input,
          materials: input.materials.map((material) => ({
            ...material,
            [change === "rights" ? "rightsConfirmed" : "consentConfirmed"]: false,
          })),
        });
      else if (change === "review")
        await env.DB.prepare(
          "INSERT INTO session_presentation_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,'rejected')",
        )
          .bind(
            crypto.randomUUID(),
            fixture.versionId,
            fixture.adminId,
            new Date(Date.parse(fixture.now) + 1000).toISOString(),
          )
          .run();
      else if (change === "owner") {
        const other = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Other session')")
          .bind(other, fixture.eventId)
          .run();
        await env.DB.prepare("UPDATE session_presentation_versions SET occurrence_id=? WHERE id=?")
          .bind(other, fixture.versionId)
          .run();
      } else {
        const assignments = {
          digest: "source_digest=?",
          bytes: "file_size=?",
          mime: "mime_type=?",
          version: "version_number=?",
        };
        const values = { digest: "b".repeat(64), bytes: 1, mime: "application/octet-stream", version: 2 };
        await env.DB.prepare(`UPDATE session_presentation_versions SET ${assignments[change]} WHERE id=?`)
          .bind(values[change], fixture.versionId)
          .run();
      }
      const before = await pdfBindingEffects();
      expect((await fixture.save(input)).status).toBe(400);
      expect(await pdfBindingEffects()).toEqual(before);
    },
  );
  it.each([
    "digest",
    "bytes",
    "mime",
    "deleted",
    "version",
    "approved review",
    "rejected review",
    "receipt source",
    "receipt digest",
    "receipt bytes",
  ] as const)("rolls back history, revision, audit and publication work when %s changes at commit", async (change) => {
    const fixture = await legacyPdfFixture();
    let authoritative = await pdfBindingEffects(),
      armed = false;
    const raced = mutateBeforeNextBatch(env.DB, async () => {
      if (change === "approved review" || change === "rejected review")
        await env.DB.prepare(
          "INSERT INTO session_presentation_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,?)",
        )
          .bind(
            crypto.randomUUID(),
            fixture.versionId,
            fixture.adminId,
            new Date(Date.parse(fixture.now) + 1000).toISOString(),
            change === "approved review" ? "approved" : "rejected",
          )
          .run();
      else if (change === "receipt source" || change === "receipt digest" || change === "receipt bytes") {
        const path =
          change === "receipt source"
            ? "$.legacyDownloads[0].sourceDigest"
            : change === "receipt digest"
              ? "$.legacyDownloads[0].pdfDigest"
              : "$.legacyDownloads[0].pdfBytes";
        await env.DB.prepare(
          "UPDATE event_agenda_session_history SET metadata_json=json_set(metadata_json,?,?) WHERE occurrence_id=?",
        )
          .bind(path, change === "receipt bytes" ? 1 : "c".repeat(64), fixture.occurrenceId)
          .run();
      } else {
        const assignments = {
          digest: "source_digest=?",
          bytes: "file_size=?",
          mime: "mime_type=?",
          deleted: "deleted_at=?",
          version: "version_number=?",
        };
        const values = {
          digest: "b".repeat(64),
          bytes: 1,
          mime: "application/octet-stream",
          deleted: fixture.now,
          version: 2,
        };
        await env.DB.prepare(`UPDATE session_presentation_versions SET ${assignments[change]} WHERE id=?`)
          .bind(values[change], fixture.versionId)
          .run();
      }
      authoritative = await pdfBindingEffects();
    });
    const db: DatabaseLike = {
      prepare(sql) {
        if (sql.startsWith("INSERT INTO session_presentation_write_guards")) armed = true;
        return env.DB.prepare(sql);
      },
      batch: (statements) => (armed ? raced : env.DB).batch(statements),
    };
    const response = await fixture.save(fixture.history, db);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "MATERIAL_VERSION_CHANGED" } });
    expect(await pdfBindingEffects()).toEqual(authoritative);
  });
  it("keeps approved history and copy immutable across edits, authorizes own kits and rejects stale artifact revisions", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin!.id, "history-kit");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const base = "/api/v1/events/pqc-2026/agenda";
    const created = await callApi(env, `${base}/occurrences`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expectedRevision: 0,
        title: "Approved session",
        description: "A substantive session about certificate lifecycle and operational cryptographic systems.",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
        speakerUserIds: [admin!.id],
      }),
    });
    expect(created.status).toBe(200);
    let snapshot = agendaSnapshotSchema.parse(await created.json());
    const occurrenceId = snapshot.occurrences[0]!.id;
    const resource = `${base}/occurrences/${occurrenceId}`;
    const history = {
      appearances: [
        {
          userId: admin!.id,
          actingIdentityId: null,
          displayName: "Synthetic Speaker",
          jobTitle: "Engineer",
          organizationName: "Historical organization",
          biography: "Approved at this event",
          photoUrl: null,
          approvedAt: "2026-10-03T00:00:00.000Z",
        },
      ],
      materials: [
        {
          id: "material",
          kind: "presentation",
          title: "Reviewed slides",
          url: "/slides.pdf",
          presentationVersionId: null,
          version: 1,
          rightsConfirmed: true,
          consentConfirmed: true,
          validated: true,
          status: "approved",
          approvedAt: "2026-10-03T00:00:00.000Z",
        },
      ],
    };
    const invalid = await callApi(env, `${resource}/history`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        history: { ...history, materials: [{ ...history.materials[0], rightsConfirmed: false }] },
      }),
    });
    expect(invalid.status).toBe(400);
    const saved = await callApi(env, `${resource}/history`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 1, history }),
    });
    expect(saved.status).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await saved.json());
    expect(snapshot.revision).toBe(2);
    const copy = {
      whyAttend: "Explore concrete certificate lifecycle practices and resilient cryptographic deployment.",
      takeaways: ["Understand deployment boundaries", "Choose operational controls"],
      callToAction: "Register for this session",
      campaign: "speaker-kit",
      approvedAt: "2026-10-03T00:00:00.000Z",
    };
    const narrative = await callApi(env, `${resource}/promotion`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 2, copy }),
    });
    expect(narrative.status).toBe(200);
    const published = await callApi(env, `${base}/publications`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 3 }),
    });
    expect(published.status).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await published.json());
    const kit = await assignedPromotionKit(env.DB, eventId, occurrenceId, admin!.id, false, "https://pkic.org");
    expect(kit.occurrence.history?.appearances[0]?.organizationName).toBe("Historical organization");
    expect(kit.kit.copy.whyAttend).toBe(copy.whyAttend);
    expect(new URL(kit.kit.registrationUrl).pathname).not.toMatch(/^\/r\//);
    expect(new URL(kit.kit.registrationUrl).searchParams.get("event")).toBe("pqc-2026");
    expect(new URL(kit.kit.registrationUrl).searchParams.get("source")).toBe("speaker-kit");
    expect(kit.kit.registrationUrl).not.toMatch(/token|manage/);
    await expect(
      assignedPromotionKit(env.DB, eventId, occurrenceId, "unassigned", false, "https://pkic.org"),
    ).rejects.toMatchObject({ status: 403 });
    const page = await listAssignedPromotionSessions(
      env.DB,
      eventId,
      admin!.id,
      agendaOccurrenceQuerySchema.parse({ q: "Approved", limit: 1, offset: 0 }),
    );
    expect(page.occurrences).toHaveLength(1);
    expect(page.page.total).toBe(1);
    expect(
      (
        await listAssignedPromotionSessions(
          env.DB,
          eventId,
          admin!.id,
          agendaOccurrenceQuerySchema.parse({ offset: 1, limit: 1 }),
        )
      ).occurrences,
    ).toHaveLength(0);
    const stale = await callApi(env, `${resource}/promotion/artifact?format=carousel&revision=1`, { headers });
    expect(stale.status).toBe(409);
    const job = await requestPromotionRender(env.DB, eventId, kit, "landscape", "https://pkic.org");
    await processPromotionRenderJob(env.DB, env, job.id, async () => {
      throw new Error("Temporary renderer failure");
    });
    const [retrying] = await queryAll<{ status: string; attempts: number }>(
      env.DB,
      "SELECT status,attempts FROM event_agenda_promotion_render_jobs WHERE id=?",
      [job.id],
    );
    expect(retrying).toMatchObject({ status: "retrying", attempts: 1 });
    await env.DB.prepare(
      "UPDATE event_agenda_promotion_render_jobs SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(job.id)
      .run();
    await processPromotionRenderJob(env.DB, env, job.id, async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      count: 1,
    }));
    const [rendered] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_agenda_promotion_render_jobs WHERE id=?",
      [job.id],
    );
    expect(rendered?.status).toBe("rendered");
    expect(
      await processPromotionRenderJob(env.DB, env, job.id, async () => {
        throw new Error("Must not render twice");
      }),
    ).toBe(false);
    const correction = await callApi(env, `${resource}/history`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expectedRevision: snapshot.revision,
        history: {
          ...history,
          appearances: [{ ...history.appearances[0], organizationName: "Corrected organization" }],
        },
      }),
    });
    expect(correction.status).toBe(200);
    expect(
      (await assignedPromotionKit(env.DB, eventId, occurrenceId, admin!.id, false, "https://pkic.org")).occurrence
        .history?.appearances[0]?.organizationName,
    ).toBe("Historical organization");
  });
  it("binds material versions to their session proposal and existing review lifecycle", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const proposal = crypto.randomUUID(),
      other = crypto.randomUUID(),
      version = crypto.randomUUID(),
      unrelated = crypto.randomUUID(),
      now = new Date().toISOString();
    for (const proposalId of [proposal, other]) {
      await env.DB.prepare(
        "INSERT INTO session_proposals(id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at) VALUES(?,?,?,'accepted','talk','Synthetic proposal','Substantial proposal',?,?,?)",
      )
        .bind(proposalId, eventId, admin!.id, crypto.randomUUID(), now, now)
        .run();
      await env.DB.prepare(
        "INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at) VALUES(?,?,?,'speaker','confirmed',?)",
      )
        .bind(crypto.randomUUID(), proposalId, admin!.id, now)
        .run();
    }
    for (const [versionId, proposalId] of [
      [version, proposal],
      [unrelated, other],
    ])
      await env.DB.prepare(
        "INSERT INTO presentation_versions(id,proposal_id,version_number,r2_key,file_name,uploaded_at) VALUES(?,?,1,?,'Reviewed slides.pdf',?)",
      )
        .bind(versionId, proposalId, `private/${versionId}`, now)
        .run();
    const agenda = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Proposal session",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
        speakerUserIds: [admin!.id],
      }),
    );
    const occurrence = agenda.occurrences[0]!;
    await env.DB.prepare("UPDATE event_agenda_occurrences SET source_key=? WHERE id=?")
      .bind(`proposal:${proposal}`, occurrence.id)
      .run();
    const metadata = sessionHistoryMetadataSchema.parse({
      materials: [
        {
          id: "slides",
          kind: "presentation",
          title: "Reviewed slides",
          url: "/events/pqc-2026/slides.pdf",
          presentationVersionId: version,
          version: 1,
          rightsConfirmed: true,
          consentConfirmed: true,
          validated: true,
          status: "approved",
          approvedAt: now,
        },
      ],
    });
    await expect(
      saveSessionHistory(env.DB, eventId, "pqc-2026", occurrence.id, 1, metadata, admin!.id),
    ).rejects.toMatchObject({ code: "MATERIAL_VERSION_NOT_APPROVED" });
    await expect(
      saveSessionHistory(
        env.DB,
        eventId,
        "pqc-2026",
        occurrence.id,
        1,
        { ...metadata, materials: [{ ...metadata.materials[0]!, presentationVersionId: unrelated }] },
        admin!.id,
      ),
    ).rejects.toMatchObject({ code: "MATERIAL_VERSION_UNAVAILABLE" });
    const choices = await listSessionMaterialVersions(
      env.DB,
      eventId,
      occurrence.id,
      sessionMaterialVersionsQuerySchema.parse({ limit: 1 }),
    );
    expect(choices.versions.map((item) => item.id)).toEqual([version]);
    expect(JSON.stringify(choices)).not.toContain("private/");
    await env.DB.prepare(
      "INSERT INTO presentation_version_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,'approved')",
    )
      .bind(crypto.randomUUID(), version, admin!.id, now)
      .run();
    const released = await saveSessionHistory(env.DB, eventId, "pqc-2026", occurrence.id, 1, metadata, admin!.id);
    expect(released.revision).toBe(2);
    expect(
      (await projectLiveAgendaMaterials(env.DB, eventId, released)).occurrences[0]!.history!.materials,
    ).toHaveLength(1);
    expect(
      (await projectLiveAgendaMaterials(env.DB, crypto.randomUUID(), released)).occurrences[0]!.history!.materials,
    ).toEqual([]);
    await saveSessionHistory(
      env.DB,
      eventId,
      "pqc-2026",
      occurrence.id,
      2,
      { ...metadata, materials: [{ ...metadata.materials[0]!, status: "failed", approvedAt: null }] },
      admin!.id,
    );
    const withdrawal = await env.DB.prepare(
      "SELECT revision,reason_code,status FROM site_publication_requests WHERE resource_type='session_material' AND resource_id=?",
    )
      .bind(occurrence.id)
      .all();
    expect(withdrawal.results).toEqual([{ revision: 3, reason_code: "rights_withdrawn", status: "queued" }]);
    const failed = await projectLiveAgendaMaterials(env.DB, eventId, released);
    expect(failed.occurrences[0]!.history!.materials).toEqual([]);
    expect(failed.occurrences[0]!.presentationUrl).toBeNull();
    expect(released.occurrences[0]!.history!.materials).toHaveLength(1);
    await saveSessionHistory(env.DB, eventId, "pqc-2026", occurrence.id, 3, metadata, admin!.id);
    await env.DB.prepare(
      "INSERT INTO presentation_version_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,'rejected')",
    )
      .bind(crypto.randomUUID(), version, admin!.id, new Date(Date.parse(now) + 1000).toISOString())
      .run();
    const revoked = await projectLiveAgendaMaterials(env.DB, eventId, released);
    expect(revoked.occurrences[0]!.history!.materials).toEqual([]);
    expect(revoked.occurrences[0]!.presentationUrl).toBeNull();
    expect(released.occurrences[0]!.history!.materials).toHaveLength(1);
    await env.DB.prepare("UPDATE presentation_versions SET deleted_at=? WHERE id=?").bind(now, version).run();
    expect((await projectLiveAgendaMaterials(env.DB, eventId, released)).occurrences[0]!.history!.materials).toEqual(
      [],
    );
  });
});
