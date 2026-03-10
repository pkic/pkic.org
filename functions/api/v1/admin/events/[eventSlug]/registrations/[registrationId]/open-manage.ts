/**
 * POST /api/v1/admin/events/:eventSlug/registrations/:registrationId/open-manage
 *   Requires a valid admin Bearer token.
 *   Signs a short-lived HS256 JWT containing { sub: registrationId, event,
 *   iphash, uahash, exp } using INTERNAL_SIGNING_SECRET — no DB write needed.
 *   Returns { manageUrl } — the full manage page URL with the JWT as the token.
 *
 *   The manage endpoint verifies the JWT signature and checks the IP + UA
 *   claims against the incoming request, so the link only works from the same
 *   browser and network it was issued from, and expires in 15 minutes.
 */
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { first } from "../../../../../../../_lib/db/queries";
import { sha256Hex } from "../../../../../../../_lib/utils/crypto";
import { registrationManagePageUrl } from "../../../../../../../_lib/services/frontend-links";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { signAdminManageJwt } from "../../../../../../../_lib/utils/jwt";
import type { PagesContext } from "../../../../../../../_lib/types";
import { json } from "../../../../../../../_lib/http";

const ADMIN_MANAGE_SESSION_MINUTES = 15;

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string; registrationId: string }>,
): Promise<Response> {
  const secret = context.env.INTERNAL_SIGNING_SECRET;
  if (!secret) {
    return json({ error: { code: "SERVER_ERROR", message: "Signing secret not configured" } }, 500);
  }

  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const registration = await first<{ id: string }>(
    context.env.DB,
    "SELECT id FROM registrations WHERE id = ? AND event_id = ?",
    [context.params.registrationId, event.id],
  );
  if (!registration) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }

  const ip =
    context.request.headers.get("cf-connecting-ip") ??
    context.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";
  const ua = context.request.headers.get("user-agent") ?? "";
  const [iphash, uahash] = await Promise.all([sha256Hex(ip), sha256Hex(ua)]);

  const jwtToken = await signAdminManageJwt(secret, {
    sub: context.params.registrationId,
    event: event.slug,
    iphash,
    uahash,
    ttlSeconds: ADMIN_MANAGE_SESSION_MINUTES * 60,
  });

  await writeAuditLog(context.env.DB, "admin", admin.id, "admin_opened_manage_page", "registration", context.params.registrationId, {
    adminEmail: admin.email,
    eventSlug: event.slug,
  });

  const appBaseUrl = resolveAppBaseUrl(context.env, context.request);
  const manageUrl = registrationManagePageUrl(appBaseUrl, event, jwtToken);

  return json({ manageUrl });
}
