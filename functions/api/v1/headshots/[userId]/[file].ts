/**
 * Public headshot image endpoint.
 *
 * GET /api/v1/headshots/:userId/:file
 *
 * Serves headshot images from the SPEAKER_UPLOADS_BUCKET R2 bucket.
 * No authentication required — the key path (headshots/{userId}/{timestamp}.{ext})
 * is unguessable and acts as a capability URL.
 *
 * Responses include long-lived Cache-Control headers so browsers and CDN
 * edge caches can serve repeated requests without hitting R2.
 */
import { json } from "../../../../_lib/http";
import type { PagesContext } from "../../../../_lib/types";

const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function onRequestGet(
  context: PagesContext<{ userId: string; file: string }>,
): Promise<Response> {
  const { userId, file } = context.params;
  const r2Key = `headshots/${userId}/${file}`;

  const bucket = context.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    return json({ error: { code: "NOT_CONFIGURED", message: "Storage not configured" } }, 503);
  }

  const obj = await bucket.get(r2Key);
  if (!obj) {
    return new Response("Not Found", { status: 404 });
  }

  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": CACHE_CONTROL,
    },
  });
}

export async function onRequest(
  context: PagesContext<{ userId: string; file: string }>,
): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
