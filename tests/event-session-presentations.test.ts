import {
  SESSION_PRESENTATION_SOURCE_KEY_HEADER,
  SESSION_PRESENTATION_SOURCE_DIGEST_HEADER,
} from "../assets/shared/schemas/session-presentation-versions";
import {
  sessionHistoryMetadataSchema,
  sessionMaterialVersionsSchema,
} from "../assets/shared/schemas/event-session-history";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { projectLiveAgendaMaterials } from "../functions/_lib/services/site-agenda-material-eligibility";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { requireAdminFromRequest } from "../functions/_lib/auth/admin";
import {
  sessionPresentationVersionResponseSchema,
  sessionPresentationVersionsSchema,
} from "../assets/shared/schemas/session-presentation-versions";
import { PRESENTATION_FILE_NAME_HEADER, PRESENTATION_FILE_SIZE_HEADER } from "../assets/shared/presentation-upload";
import { uploadSessionPresentation } from "../functions/_lib/services/event-agenda/session-presentation-upload";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";
let eventId: string, occurrenceId: string, adminId: string, token: string;
const pdf = "%PDF-1.7\nSynthetic session document\n%%EOF";
function headers(authenticated = true) {
  return { ...(authenticated ? { authorization: `Bearer ${token}` } : {}) };
}
function uploadRequest(declared = pdf.length, authenticated = true) {
  return new Request("https://app.test/upload", {
    method: "POST",
    headers: {
      ...headers(authenticated),
      "content-type": "application/pdf",
      [PRESENTATION_FILE_NAME_HEADER]: encodeURIComponent("Session slides.pdf"),
      [PRESENTATION_FILE_SIZE_HEADER]: String(declared),
    },
    body: pdf,
  });
}
function path(version = "") {
  return `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/materials/presentations${version}`;
}
async function upload() {
  const request = uploadRequest();
  return callApi(env, path(), { method: "POST", headers: request.headers, body: request.body });
}
beforeEach(async () => {
  await resetDb();
  ({ eventId } = await seedEventAndAdmin(env.DB));
  adminId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
  token = await createAdminSession(env.DB, adminId, "session-presentation-test");
  occurrenceId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,title,description) VALUES(?,?,'Historical session without proposal','')",
  )
    .bind(occurrenceId, eventId)
    .run();
});
describe("Direct session presentation uploads and review", () => {
  it("uploads without a proposal, lists bounded versions, downloads exact bytes and preserves review history", async () => {
    const response = await upload();
    expect(response.status).toBe(200);
    const first = sessionPresentationVersionResponseSchema.parse(await response.json()).version;
    expect(first).toMatchObject({
      occurrenceId,
      versionNumber: 1,
      isCurrent: true,
      latestReview: null,
      fileName: "Session slides.pdf",
    });
    expect(JSON.stringify(first)).not.toContain("r2Key");
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM session_proposals").first<{ count: number }>())?.count,
    ).toBe(0);
    const download = await callApi(env, path(`/${first.id}/content`), { headers: headers() });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(pdf);
    expect(download.headers.get("cache-control")).toMatch(/(?:^|,\s*)no-store(?:,|$)/u);
    const review = await callApi(env, path(`/${first.id}/reviews`), {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", note: "Reviewed PDF" }),
    });
    expect(review.status).toBe(200);
    expect(sessionPresentationVersionResponseSchema.parse(await review.json()).version.latestReview?.status).toBe(
      "approved",
    );
    const secondResponse = await upload();
    expect(secondResponse.status).toBe(200);
    const second = sessionPresentationVersionResponseSchema.parse(await secondResponse.json()).version;
    expect(second).toMatchObject({ versionNumber: 2, isCurrent: true, latestReview: null });
    const list = await callApi(env, `${path()}?limit=1&sort=-versionNumber`, { headers: headers() });
    expect(list.status).toBe(200);
    const page = sessionPresentationVersionsSchema.parse(await list.json());
    expect(page.versions.map((version) => version.id)).toEqual([second.id]);
    expect(page.page.total).toBe(2);
    expect((await callApi(env, path(`/${first.id}`), { method: "DELETE", headers: headers() })).status).toBe(409);
    expect((await callApi(env, path(`/${second.id}`), { method: "DELETE", headers: headers() })).status).toBe(200);
    const remaining = sessionPresentationVersionsSchema.parse(
      await (await callApi(env, path(), { headers: headers() })).json(),
    );
    expect(remaining.versions).toHaveLength(1);
    expect(remaining.versions[0]).toMatchObject({
      id: first.id,
      isCurrent: true,
      latestReview: { status: "approved" },
    });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_publications").first<{ count: number }>())
        ?.count,
    ).toBe(0);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS count FROM storage_deletion_outbox WHERE status='queued'").first<{
          count: number;
        }>()
      )?.count,
    ).toBeGreaterThan(0);
  });
  it("rejects unauthenticated, wrong-session, unsupported and dishonest uploads without creating versions", async () => {
    const unauth = uploadRequest(pdf.length, false);
    expect((await callApi(env, path(), { method: "POST", headers: unauth.headers, body: unauth.body })).status).toBe(
      401,
    );
    const unsupported = uploadRequest();
    unsupported.headers.set("content-type", "text/plain");
    expect(
      (await callApi(env, path(), { method: "POST", headers: unsupported.headers, body: unsupported.body })).status,
    ).toBe(415);
    const dishonest = uploadRequest(pdf.length + 1);
    expect(
      (await callApi(env, path(), { method: "POST", headers: dishonest.headers, body: dishonest.body })).status,
    ).toBe(400);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM session_presentation_versions").first<{ count: number }>())
        ?.count,
    ).toBe(0);
    const response = await upload();
    const version = sessionPresentationVersionResponseSchema.parse(await response.json()).version;
    const other = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Other')")
      .bind(other, eventId)
      .run();
    expect(
      (await callApi(env, path(`/${version.id}/content`).replace(occurrenceId, other), { headers: headers() })).status,
    ).toBe(404);
  });
  it("compensates a lost upload authority and rolls back metadata and audit together", async () => {
    const actor = await requireAdminFromRequest(env.DB, new Request("https://app.test", { headers: headers() }), env);
    const before = await env.SPEAKER_UPLOADS_BUCKET!.list({ prefix: `session-presentations/${eventId}/` });
    const db = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(adminId).run();
    });
    await expect(
      uploadSessionPresentation(db, env.SPEAKER_UPLOADS_BUCKET!, { eventId, occurrenceId, actor }, uploadRequest()),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM session_presentation_versions").first<{ count: number }>())
        ?.count,
    ).toBe(0);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM audit_log WHERE action='session.presentation.uploaded'",
        ).first<{ count: number }>()
      )?.count,
    ).toBe(0);
    const after = await env.SPEAKER_UPLOADS_BUCKET!.list({ prefix: `session-presentations/${eventId}/` });
    expect(after.objects).toEqual(before.objects);
  });
  it("binds concurrent versions atomically and compensates the losing object", async () => {
    const actor = await requireAdminFromRequest(env.DB, new Request("https://app.test", { headers: headers() }), env);
    let ready = 0;
    let release: () => void = () => undefined;
    const bothUploaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atCommit = async () => {
      if (++ready === 2) release();
      await bothUploaded;
    };
    const authority = { eventId, occurrenceId, actor };
    const outcomes = await Promise.allSettled([
      uploadSessionPresentation(
        mutateBeforeNextBatch(env.DB, atCommit),
        env.SPEAKER_UPLOADS_BUCKET!,
        authority,
        uploadRequest(),
      ),
      uploadSessionPresentation(
        mutateBeforeNextBatch(env.DB, atCommit),
        env.SPEAKER_UPLOADS_BUCKET!,
        authority,
        uploadRequest(),
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: { status: 409, code: "SESSION_PRESENTATION_CHANGED" },
    });
    const page = sessionPresentationVersionsSchema.parse(
      await (await callApi(env, path(), { headers: headers() })).json(),
    );
    expect(page.versions).toHaveLength(1);
    expect(page.versions[0].versionNumber).toBe(1);
    const objects = await env.SPEAKER_UPLOADS_BUCKET!.list({
      prefix: `session-presentations/${eventId}/${occurrenceId}/`,
    });
    expect(objects.objects).toHaveLength(1);
  });
  it("verifies historical byte provenance, replays the same source version and cleans mismatched bytes", async () => {
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pdf))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const sourceKey = "content/events/2023/conference/Session slides.pdf";
    const sourced = () => {
      const request = uploadRequest();
      request.headers.set(SESSION_PRESENTATION_SOURCE_KEY_HEADER, encodeURIComponent(sourceKey));
      request.headers.set(SESSION_PRESENTATION_SOURCE_DIGEST_HEADER, digest);
      return callApi(env, path(), { method: "POST", headers: request.headers, body: request.body });
    };
    const firstResponse = await sourced();
    expect(firstResponse.status).toBe(200);
    const first = sessionPresentationVersionResponseSchema.parse(await firstResponse.json()).version;
    expect(first).toMatchObject({ sourceKey, sourceDigest: digest, latestReview: null });
    const replay = await sourced();
    expect(replay.status).toBe(200);
    expect(sessionPresentationVersionResponseSchema.parse(await replay.json()).version.id).toBe(first.id);
    expect(
      (await env.SPEAKER_UPLOADS_BUCKET!.list({ prefix: `session-presentations/${eventId}/${occurrenceId}/` })).objects,
    ).toHaveLength(1);
    const mismatched = uploadRequest();
    mismatched.headers.set(
      SESSION_PRESENTATION_SOURCE_KEY_HEADER,
      encodeURIComponent("content/events/2023/different.pdf"),
    );
    mismatched.headers.set(SESSION_PRESENTATION_SOURCE_DIGEST_HEADER, "0".repeat(64));
    expect(
      (await callApi(env, path(), { method: "POST", headers: mismatched.headers, body: mismatched.body })).status,
    ).toBe(400);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM session_presentation_versions").first<{ count: number }>())
        ?.count,
    ).toBe(1);
    expect(
      (await env.SPEAKER_UPLOADS_BUCKET!.list({ prefix: `session-presentations/${eventId}/${occurrenceId}/` })).objects,
    ).toHaveLength(1);
  });
  it("binds reviewed direct versions through the existing archive catalogue without automatic release", async () => {
    const uploaded = await upload();
    const version = sessionPresentationVersionResponseSchema.parse(await uploaded.json()).version;
    const catalogue = await callApi(
      env,
      `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/history/materials`,
      { headers: headers() },
    );
    expect(catalogue.status).toBe(200);
    expect(sessionMaterialVersionsSchema.parse(await catalogue.json()).versions).toEqual([
      expect.objectContaining({ id: version.id, source: "session", reviewStatus: null }),
    ]);
    const history = sessionHistoryMetadataSchema.parse({
      materials: [
        {
          id: "slides",
          kind: "presentation",
          title: "Slides",
          url: "",
          presentationSource: "session",
          presentationVersionId: version.id,
          version: 1,
          rightsConfirmed: true,
          consentConfirmed: true,
          validated: true,
          status: "approved",
          approvedAt: new Date().toISOString(),
        },
      ],
    });
    const save = () =>
      callApi(env, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/history`, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 0, history }),
      });
    expect((await save()).status).toBe(400);
    expect(
      (
        await callApi(env, path(`/${version.id}/reviews`), {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        })
      ).status,
    ).toBe(200);
    const savedResponse = await save();
    expect(savedResponse.status).toBe(200);
    const saved = agendaSnapshotSchema.parse(await savedResponse.json());
    expect(saved.occurrences[0].history?.materials[0].url).toContain(`/presentations/${version.id}/releases/`);
    expect((await projectLiveAgendaMaterials(env.DB, eventId, saved)).occurrences[0].history?.materials).toHaveLength(
      1,
    );
    expect(
      (
        await callApi(env, path(`/${version.id}/reviews`), {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({ status: "needs_revision" }),
        })
      ).status,
    ).toBe(200);
    expect((await projectLiveAgendaMaterials(env.DB, eventId, saved)).occurrences[0].history?.materials).toEqual([]);
    expect((await callApi(env, path(`/${version.id}`), { method: "DELETE", headers: headers() })).status).toBe(409);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_publications").first<{ count: number }>())
        ?.count,
    ).toBe(0);
  });
});
