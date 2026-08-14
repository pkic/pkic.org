/**
 * GET /api/v1/proposals/speaker/[token]/presentation/download
 *
 * Lets a speaker download their own current presentation.
 */
import { json } from "../../../../../../_lib/http";
import { getSpeakerByManageToken } from "../../../../../../_lib/services/proposals";
import {
  getCurrentPresentationVersion,
  presentationDownloadResponse,
} from "../../../../../../_lib/services/presentation-versions";
import { requireInternalSecret } from "../../../../../../_lib/request";

export async function onRequestGet(c: any): Promise<Response> {
  const { proposal } = await getSpeakerByManageToken(c.env.DB, c.req.param("token"), requireInternalSecret(c.env));

  const version = await getCurrentPresentationVersion(c.env.DB, proposal.id);

  if (!version) return json({ error: { code: "NO_PRESENTATION", message: "No presentation uploaded yet" } }, 404);

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) return json({ error: { message: "File storage not configured" } }, 503);

  const object = await bucket.get(version.r2Key);
  if (!object) return json({ error: { message: "File not found in storage" } }, 404);

  return presentationDownloadResponse(object, version);
}
