import { json } from "../../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { getPresentationVersion } from "../../../../../../../../_lib/services/presentation-versions";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const versionId = c.req.param("versionId");

  const version = await getPresentationVersion(requestDb(c), versionId);

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) return json({ error: { message: "File storage not configured" } }, 503);

  const object = await bucket.get(version.r2Key);
  if (!object) return json({ error: { message: "File not found in storage" } }, 404);

  const fileName = version.fileName ?? `presentation-v${version.versionNumber}`;
  const headers = new Headers();
  headers.set("Content-Type", version.mimeType ?? "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
  headers.set("Content-Length", String(object.size));

  return new Response(object.body, { headers });
}
