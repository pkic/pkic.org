import { json } from "../../../../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { invalidateAndRerender } from "../../../../../../../_lib/services/og-badge-prerender";
import { getProposalByManageToken } from "../../../../../../../_lib/services/proposals";
import { AppError } from "../../../../../../../_lib/errors";
import { first } from "../../../../../../../_lib/db/queries";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { SPEAKER_HEADSHOT_MAX_BYTES } from "../../../../../../../../assets/shared/schemas/images";
import { readValidatedUploadedImage } from "../../../../../../../_lib/utils/image-upload";
import {
  removePreviousHeadshot,
  removeUserHeadshot,
  replaceUserHeadshot,
} from "../../../../../../../_lib/services/user-headshot";
import { storedImageResponse } from "../../../../../../../_lib/services/image-response";

async function loadSpeakerContext(c: any) {
  const proposal = await getProposalByManageToken(c.env.DB, c.req.param("token"), requireInternalSecret(c.env));
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

  return storedImageResponse(bucket, speaker.headshot_r2_key, {
    notFoundCode: "NOT_FOUND",
    notFoundMessage: "Headshot file missing from storage",
    cacheControl: "private, max-age=3600",
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

  const image = await readValidatedUploadedImage(c.req.raw, "Headshot", SPEAKER_HEADSHOT_MAX_BYTES);
  const r2Key = await replaceUserHeadshot({
    db: c.env.DB,
    bucket,
    userId: speaker.user_id,
    previousKey: speaker.headshot_r2_key,
    image,
    source: "proposal_manage_upload",
    audit: {
      actorType: "user",
      actorId: proposal.proposer_user_id,
      action: "speaker_headshot_uploaded_by_proposer",
      entityType: "proposal_speaker",
      entityId: speaker.id,
      details: { proposalId: proposal.id, speakerUserId: speaker.user_id },
    },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(c.env.DB, c.env, speaker.headshot_r2_key));

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
  await removeUserHeadshot({
    db: c.env.DB,
    userId: speaker.user_id,
    previousKey: speaker.headshot_r2_key,
    audit: {
      actorType: "user",
      actorId: proposal.proposer_user_id,
      action: "speaker_headshot_deleted_by_proposer",
      entityType: "proposal_speaker",
      entityId: speaker.id,
      details: { proposalId: proposal.id, speakerUserId: speaker.user_id },
    },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(c.env.DB, c.env, speaker.headshot_r2_key));

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
