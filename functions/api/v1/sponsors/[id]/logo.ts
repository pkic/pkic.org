/**
 * GET /api/v1/sponsors/:id/logo
 *
 * Public non-member sponsor logo. `id` is a `sponsorships.id` — org-tied
 * (consortium or member-linked event) sponsors already have a logo at
 * GET /api/v1/members/:id/logo, since they're backed by an organizations row.
 */
import { OpenAPIRoute } from "chanfana";
import { AppError } from "../../../../_lib/errors";
import { getNonMemberSponsorLogoR2Key } from "../../../../_lib/services/public-sponsors";
import { sponsorLogoRouteSchema } from "../../../../../assets/shared/schemas/public-sponsors";

const PUBLIC_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600";

function guessMimeType(r2Key: string): string {
  const ext = r2Key.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "image/jpeg";
}

export async function onRequestGet(c: any): Promise<Response> {
  const id = c.req.param("id");
  const logoR2Key = await getNonMemberSponsorLogoR2Key(c.env.DB, id);
  if (!logoR2Key) {
    throw new AppError(404, "LOGO_NOT_FOUND", "No logo on file for this sponsor");
  }

  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "Asset storage is not configured");
  }

  const obj = await bucket.get(logoR2Key);
  if (!obj) {
    throw new AppError(404, "LOGO_NOT_FOUND", "Logo file missing from storage");
  }

  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": guessMimeType(logoR2Key),
      "Cache-Control": PUBLIC_CACHE_CONTROL,
    },
  });
}

export class SponsorsIdLogoGet extends OpenAPIRoute {
  schema = sponsorLogoRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
