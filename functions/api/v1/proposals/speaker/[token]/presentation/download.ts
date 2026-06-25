/**
 * GET /api/v1/proposals/speaker/[token]/presentation/download
 *
 * Lets a speaker download their own current presentation.
 */
import { json } from "../../../../../../_lib/http";
import { getSpeakerByManageToken } from "../../../../../../_lib/services/proposals";
import { first } from "../../../../../../_lib/db/queries";

export async function onRequestGet(c: any): Promise<Response> {
  const { proposal } = await getSpeakerByManageToken(c.env.DB, c.req.param("token"));

  const version = await first<{
    r2_key: string;
    file_name: string | null;
    mime_type: string | null;
    version_number: number;
  }>(
    c.env.DB,
    "SELECT r2_key, file_name, mime_type, version_number FROM presentation_versions WHERE proposal_id = ? AND is_current = 1 AND deleted_at IS NULL",
    [proposal.id],
  );

  if (!version) return json({ error: { code: "NO_PRESENTATION", message: "No presentation uploaded yet" } }, 404);

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) return json({ error: { message: "File storage not configured" } }, 503);

  const object = await bucket.get(version.r2_key);
  if (!object) return json({ error: { message: "File not found in storage" } }, 404);

  const fileName = version.file_name ?? `presentation-v${version.version_number}`;
  const safeFileName = fileName.replace(/["\r\n]/g, "_");
  const headers = new Headers();
  headers.set("Content-Type", version.mime_type ?? "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  headers.set("Content-Length", String(object.size));

  return new Response(object.body, { headers });
}
