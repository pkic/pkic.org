import { json } from "../../../../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { invalidateAndRerender } from "../../../../../../../_lib/services/og-badge-prerender";
import { getProposalByManageToken } from "../../../../../../../_lib/services/proposals";
import { updateSpeakerProfile } from "../../../../../../../_lib/services/proposals-speaker-profile";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { AppError } from "../../../../../../../_lib/errors";
import { first, run } from "../../../../../../../_lib/db/queries";
import { nowIso } from "../../../../../../../_lib/utils/time";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HEADSHOT_BYTES = 20 * 1024 * 1024;

async function loadSpeakerContext(c: any) {
  const proposal = await getProposalByManageToken(c.env.DB, c.req.param("token"));
  const speaker = await first<{
    id: string;
    user_id: string;
    status: string;
    headshot_r2_key: string | null;
  }>(
    c.env.DB,
    `SELECT ps.id, ps.user_id, ps.status, u.headshot_r2_key
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.user_id = ?`,
    [proposal.id, c.req.param("userId")],
  );

  if (!speaker) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  if (proposal.status === "withdrawn" || proposal.status === "rejected") {
    throw new AppError(400, "PROPOSAL_CLOSED", "Cannot update speakers on a closed proposal");
  }
  return { proposal, speaker };
}

async function onRequestGet(c: any): Promise<Response> {
  const { speaker } = await loadSpeakerContext(c);
  if (!speaker.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");

  const obj = await bucket.get(speaker.headshot_r2_key);
  if (!obj) {
    return json({ error: { code: "NOT_FOUND", message: "Headshot file missing from storage" } }, 404);
  }

  const ext = speaker.headshot_r2_key.split(".").pop()?.toLowerCase() ?? "";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function onRequestPut(c: any): Promise<Response> {
  const { proposal, speaker } = await loadSpeakerContext(c);
  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;

  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");

  const contentType = c.req.raw.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: { code: "INVALID_CONTENT_TYPE", message: "Request must be multipart/form-data" } }, 400);
  }

  const formData = await c.req.raw.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return json({ error: { code: "MISSING_FILE", message: 'A "file" field is required.' } }, 400);
  }

  const blob = file as File;
  if (!ALLOWED_MIME_TYPES.has(blob.type)) {
    return json(
      { error: { code: "INVALID_FILE_TYPE", message: "Only JPEG, PNG, and WebP images are accepted." } },
      415,
    );
  }
  if (blob.size > MAX_HEADSHOT_BYTES) {
    return json({ error: { code: "FILE_TOO_LARGE", message: "Headshot must be under 20 MB." } }, 413);
  }

  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const r2Key = `headshots/${speaker.user_id}/${Date.now()}.${ext}`;
  await bucket.put(r2Key, await blob.arrayBuffer(), {
    httpMetadata: { contentType: blob.type },
  });

  if (speaker.headshot_r2_key) {
    c.executionCtx.waitUntil(
      (bucket as unknown as { delete(key: string): Promise<void> }).delete(speaker.headshot_r2_key).catch(() => {}),
    );
  }

  await updateSpeakerProfile(c.env.DB, speaker.user_id, { headshotR2Key: r2Key });

  await writeAuditLog(
    c.env.DB,
    "user",
    proposal.proposer_user_id,
    "speaker_headshot_uploaded_by_proposer",
    "proposal_speaker",
    speaker.id,
    { proposalId: proposal.id, speakerUserId: speaker.user_id, r2Key },
  );

  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  await invalidateAndRerender(speaker.user_id, c.env, origin);

  return json({
    success: true,
    r2Key,
    headshotUrl: `${origin}/api/v1/proposals/manage/${encodeURIComponent(c.req.param("token"))}/speakers/${encodeURIComponent(speaker.user_id)}/headshot?v=${encodeURIComponent(String(Date.now()))}`,
  });
}

export async function onRequestDelete(c: any): Promise<Response> {
  const { proposal, speaker } = await loadSpeakerContext(c);
  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;

  if (bucket && speaker.headshot_r2_key) {
    try {
      await (bucket as unknown as { delete(key: string): Promise<void> }).delete(speaker.headshot_r2_key);
    } catch {
      // Non-fatal.
    }
  }

  await run(
    c.env.DB,
    "UPDATE users SET headshot_r2_key = NULL, headshot_updated_at = NULL, updated_at = ? WHERE id = ?",
    [nowIso(), speaker.user_id],
  );

  await writeAuditLog(
    c.env.DB,
    "user",
    proposal.proposer_user_id,
    "speaker_headshot_deleted_by_proposer",
    "proposal_speaker",
    speaker.id,
    { proposalId: proposal.id, speakerUserId: speaker.user_id },
  );

  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  await invalidateAndRerender(speaker.user_id, c.env, origin);

  return json({ success: true });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PUT") return onRequestPut(c);
  if (c.req.raw.method === "DELETE") return onRequestDelete(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
