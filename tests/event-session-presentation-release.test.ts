import { requirePresentationBucket } from "../functions/_lib/services/presentation-upload";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { sessionPresentationPublicUrl } from "../assets/shared/session-presentation-public-url";
import {
  publicSessionMediaUrlSchema,
  sessionHistoryMetadataSchema,
} from "../assets/shared/schemas/event-session-history";
import { resolvePublishedDocuments } from "../functions/_lib/services/site-publication-documents";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import {
  sitePublicationDocumentRoutesSchema,
  PUBLICATION_DOCUMENT_ROUTES_PATH,
  type SitePublicationDocumentRoutes,
} from "../assets/shared/schemas/site-publication-release";
import {
  publicationDocumentAllowSchema,
  publicationDocumentEffectSchema,
  publicationDocumentGrantId,
  publicationDocumentStorageKey,
} from "../assets/shared/schemas/site-publication-documents";
import {
  writePublicationDocumentAllow,
  writePublicationDocumentDenial,
} from "../functions/_lib/services/site-publication-document-projection";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import type { Env } from "../functions/_lib/types";
let eventId: string,
  userId: string,
  occurrenceId: string,
  versionId: string,
  digest: string,
  url: string,
  token: string;
const pdf = "%PDF-1.7\nApproved public PDF\n%%EOF",
  buildId = "document-publication-build",
  snapshotId = "a".repeat(64);
let material: Record<string, unknown>, artifact: SitePublicationDocumentRoutes | null;
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
      get DB(): Env["DB"] {
        throw new Error("D1 must not be accessed");
      },
      SERVICE_MODE: "maintenance",
    };
  return { ...env, ASSETS: assets };
}
beforeEach(async () => {
  await resetDb();
  artifact = null;
  ({ eventId } = await seedEventAndAdmin(env.DB));
  userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
  token = await createAdminSession(env.DB, userId, crypto.randomUUID());
  occurrenceId = crypto.randomUUID();
  versionId = crypto.randomUUID();
  digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pdf))), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  url = sessionPresentationPublicUrl({ eventSlug: "pqc-2026", occurrenceId, versionId, digest });
  material = {
    id: "approved-slides",
    kind: "presentation",
    title: "Slides",
    url,
    presentationSource: "session",
    presentationVersionId: versionId,
    version: 1,
    rightsConfirmed: true,
    consentConfirmed: true,
    validated: true,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvalNonce: crypto.randomUUID(),
  };
  await env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title,description) VALUES(?,?,'Session','')")
    .bind(occurrenceId, eventId)
    .run();
  await requirePresentationBucket(env).put(`session-presentations/${versionId}`, pdf);
  await env.DB.prepare(
    "INSERT INTO session_presentation_versions(id,event_id,occurrence_id,version_number,r2_key,file_name,file_size,mime_type,source_digest,uploaded_by_user_id,uploaded_at) VALUES(?,?,?,1,?,'slides.pdf',?,'application/pdf',?,?,?)",
  )
    .bind(
      versionId,
      eventId,
      occurrenceId,
      `session-presentations/${versionId}`,
      pdf.length,
      digest,
      userId,
      new Date().toISOString(),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
  )
    .bind(occurrenceId, JSON.stringify({ materials: [material] }), userId, new Date().toISOString())
    .run();
});
async function approve() {
  await env.DB.prepare(
    "INSERT INTO session_presentation_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,'approved')",
  )
    .bind(crypto.randomUUID(), versionId, userId, new Date().toISOString())
    .run();
}
async function activate() {
  const grantId = await publicationDocumentGrantId({
    eventSlug: "pqc-2026",
    occurrenceId,
    materialId: String(material.id),
    versionId,
    digest,
    approvedAt: String(material.approvedAt),
    approvalNonce: String(material.approvalNonce),
  });
  const objectEtag = (await requirePresentationBucket(env).head(`session-presentations/${versionId}`))!.etag;
  const allow = publicationDocumentAllowSchema.parse({
    version: 1,
    eventId,
    eventSlug: "pqc-2026",
    occurrenceId,
    materialId: material.id,
    versionId,
    digest,
    grantId,
    r2Key: `session-presentations/${versionId}`,
    fileName: "slides.pdf",
    versionNumber: 1,
    fileSize: pdf.length,
    objectEtag,
    approvedAt: material.approvedAt,
    approvalNonce: material.approvalNonce,
  });
  await writePublicationDocumentAllow(requirePresentationBucket(env), allow);
  await env.DB.prepare(
    "INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,grant_id) VALUES(?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      `${buildId}:${grantId}`,
      snapshotId,
      eventId,
      occurrenceId,
      material.id,
      versionId,
      digest,
      objectEtag,
      grantId,
    )
    .run();
  artifact = sitePublicationDocumentRoutesSchema.parse({
    version: 1,
    snapshotId,
    sourceSequence: 1,
    documents: [{ url, grantId }],
    redirects: [],
    retiredPaths: [],
  });
  return allow;
}
async function save(values: Record<string, unknown>, environment = publicEnvironment()) {
  const agenda = await getAgenda(env.DB, eventId, "pqc-2026");
  const history = sessionHistoryMetadataSchema.parse({ materials: [{ ...material, ...values }] });
  const response = await callApi(environment, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/history`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: agenda.revision, history }),
  });
  const updated = await env.DB.prepare("SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?")
    .bind(occurrenceId)
    .first<{ metadata_json: string }>();
  material = sessionHistoryMetadataSchema.parse(JSON.parse(updated!.metadata_json)).materials[0]!;
  return response;
}
describe("Static selected public PDF with private terminal authority", () => {
  it("serves cold exact bytes without D1/auth, including cookies and maintenance; private downloads remain authorized", async () => {
    expect((await callApi(publicEnvironment(), url)).status).toBe(404);
    await approve();
    expect((await callApi(publicEnvironment(), url)).status).toBe(404);
    await activate();
    const cookieCases: HeadersInit[] = [
      {},
      { cookie: "session=not-a-valid-session", authorization: "Bearer arbitrary" },
    ];
    for (const headers of cookieCases) {
      const response = await callApi(publicEnvironment(true), url, { headers });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(pdf);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("application/pdf");
    }
    expect((await callApi(publicEnvironment(true), url.replace(digest, "0".repeat(64)))).status).toBe(404);
    expect((await callApi(publicEnvironment(), url.replace(`/releases/${digest}`, ""))).status).toBe(401);
    expect(publicSessionMediaUrlSchema.safeParse(url).success).toBe(true);
    expect(publicSessionMediaUrlSchema.safeParse(`${url}?token=secret`).success).toBe(false);
  });
  it("checks authority before HEAD, conditional and bounded range responses", async () => {
    await approve();
    const allow = await activate();
    const environment = publicEnvironment(true);
    const head = await callApi(environment, url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe(String(pdf.length));
    expect((await callApi(environment, url, { headers: { "if-none-match": `W/"${digest}"` } })).status).toBe(304);
    const partial = await callApi(environment, url, { headers: { range: "bytes=0-4" } });
    expect(partial.status).toBe(206);
    expect(await partial.text()).toBe("%PDF-");
    expect(partial.headers.get("content-range")).toBe(`bytes 0-4/${pdf.length}`);
    expect((await callApi(environment, url, { headers: { range: "bytes=999-1000" } })).status).toBe(416);
    const full = await callApi(environment, url, { headers: { range: "bytes=0-4", "if-range": '"other"' } });
    expect(full.status).toBe(200);
    expect(await full.text()).toBe(pdf);
    await writePublicationDocumentDenial(
      requirePresentationBucket(env),
      publicationDocumentEffectSchema.strip().parse(allow),
    );
    const revokedCases: RequestInit[] = [
      {},
      { method: "HEAD" },
      { headers: { "if-none-match": `"${digest}"` } },
      { headers: { range: "bytes=0-4" } },
    ];
    for (const init of revokedCases) expect((await callApi(environment, url, init)).status).toBe(404);
    await expect(writePublicationDocumentAllow(requirePresentationBucket(env), allow)).rejects.toThrow(
      "PUBLICATION_DOCUMENT_DENIED",
    );
  });
  it("mounted rights withdrawal denies an old deployed selection; explicit rerelease alone gets a new grant", async () => {
    await approve();
    const original = await activate();
    expect(
      (
        await save({
          title: "Editorial title",
          approvedAt: "2099-01-01T00:00:00.000Z",
          approvalNonce: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(material.approvalNonce).toBe(original.approvalNonce);
    expect(material.approvedAt).toBe(original.approvedAt);
    expect((await save({ status: "withdrawn", consentConfirmed: false })).status).toBe(200);
    expect((await callApi(publicEnvironment(true), url)).status).toBe(404);
    expect(
      await requirePresentationBucket(env).head(publicationDocumentStorageKey(original.grantId, "deny")),
    ).not.toBeNull();
    expect(
      (await save({ status: "approved", consentConfirmed: true, approvalNonce: original.approvalNonce })).status,
    ).toBe(200);
    expect(material.approvalNonce).not.toBe(original.approvalNonce);
    expect((await callApi(publicEnvironment(true), url)).status).toBe(404);
    const replacement = await activate();
    expect(replacement.grantId).not.toBe(original.grantId);
    const response = await callApi(publicEnvironment(true), url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(pdf);
    await expect(writePublicationDocumentAllow(requirePresentationBucket(env), original)).rejects.toThrow(
      "PUBLICATION_DOCUMENT_DENIED",
    );
  });
  it("a mounted rejected review terminally denies the version; a later approved review cannot revive the same grant", async () => {
    await approve();
    const selected = await activate();
    const review = async (status: "rejected" | "approved") =>
      callApi(
        publicEnvironment(),
        `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}/materials/presentations/${versionId}/reviews`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
    expect((await review("rejected")).status).toBe(200);
    expect((await callApi(publicEnvironment(true), url)).status).toBe(404);
    expect((await review("approved")).status).toBe(200);
    expect((await callApi(publicEnvironment(true), url)).status).toBe(404);
    await expect(writePublicationDocumentAllow(requirePresentationBucket(env), selected)).rejects.toThrow(
      "PUBLICATION_DOCUMENT_DENIED",
    );
    const request = await env.DB.prepare(
      "SELECT document_effects_completed_at FROM site_publication_requests WHERE reason_code='version_review_changed' AND document_effects_json<>'[]'",
    ).first<{ document_effects_completed_at: string | null }>();
    expect(request?.document_effects_completed_at).not.toBeNull();
  });
  it("records a truthful pending refusal when private denial fails, without losing the durable effect", async () => {
    await approve();
    await activate();
    const response = await save({ status: "withdrawn" }, { ...publicEnvironment(), SPEAKER_UPLOADS_BUCKET: undefined });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "PUBLICATION_DOCUMENT_WITHDRAWAL_PENDING", message: expect.stringContaining("change is saved") },
    });
    expect(material.status).toBe("withdrawn");
    const request = await env.DB.prepare(
      "SELECT document_effects_json,document_effects_completed_at FROM site_publication_requests WHERE reason_code='rights_withdrawn'",
    ).first<{ document_effects_json: string; document_effects_completed_at: string | null }>();
    expect(JSON.parse(request!.document_effects_json)).toHaveLength(1);
    expect(request!.document_effects_completed_at).toBeNull();
  });
  it("fails closed on absent/malformed projections and changed same-size private bytes", async () => {
    await approve();
    const allow = await activate();
    await requirePresentationBucket(env).put(`session-presentations/${versionId}`, pdf.replace("Approved", "Modified"));
    expect((await callApi(publicEnvironment(true), url)).status).toBe(404);
    await requirePresentationBucket(env).delete(publicationDocumentStorageKey(allow.grantId, "allow"));
    expect((await callApi(publicEnvironment(true), url)).status).toBe(404);
    await requirePresentationBucket(env).put(publicationDocumentStorageKey(allow.grantId, "allow"), "{}");
    expect((await callApi(publicEnvironment(true), url)).status).toBe(503);
  });
  it("resolves only a current exact selection; a snapshot URL mismatch cannot mint authority", async () => {
    await approve();
    const agenda = agendaSnapshotSchema.parse({
      eventSlug: "pqc-2026",
      timeZone: "UTC",
      publishedRevision: 1,
      revision: 1,
      rooms: [],
      occurrences: [
        {
          id: occurrenceId,
          title: "Session",
          startAt: null,
          endAt: null,
          roomId: null,
          speakers: [],
          history: { materials: [material] },
        },
      ],
      shifts: [],
      roleMembers: [],
      assignments: [],
    });
    const snapshot = sitePublicationSnapshotSchema.parse({
      version: 1,
      snapshotId,
      sourceSequence: 1,
      eventAgendas: { "pqc-2026": agenda },
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
    expect(await resolvePublishedDocuments(env.DB, snapshot)).toEqual([
      expect.objectContaining({
        eventId,
        occurrenceId,
        materialId: material.id,
        versionId,
        digest,
        r2Key: `session-presentations/${versionId}`,
        fileSize: pdf.length,
        grantId: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    snapshot.eventAgendas!["pqc-2026"].occurrences[0]!.history!.materials[0]!.url = "/content-media/unrelated.pdf";
    await expect(resolvePublishedDocuments(env.DB, snapshot)).rejects.toThrow("verified version");
  });
});
