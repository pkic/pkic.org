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
import { json } from "../../../../../../../_lib/http";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

const ADMIN_MANAGE_SESSION_MINUTES = 15;

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const secret = c.env.INTERNAL_SIGNING_SECRET;
  if (!secret) {
    return json({ error: { code: "SERVER_ERROR", message: "Signing secret not configured" } }, 500);
  }

  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const registrationId = c.req.param("registrationId");

  const registration = await first<{ id: string }>(
    requestDb(c),
    "SELECT id FROM registrations WHERE id = ? AND event_id = ?",
    [registrationId, event.id],
  );
  if (!registration) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }

  const ip =
    c.req.raw.headers.get("cf-connecting-ip") ?? c.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ua = c.req.raw.headers.get("user-agent") ?? "";
  const [iphash, uahash] = await Promise.all([sha256Hex(ip), sha256Hex(ua)]);

  const jwtToken = await signAdminManageJwt(secret, {
    sub: registrationId,
    event: event.slug,
    iphash,
    uahash,
    ttlSeconds: ADMIN_MANAGE_SESSION_MINUTES * 60,
  });

  await writeAuditLog(requestDb(c), "admin", admin.id, "admin_opened_manage_page", "registration", registrationId, {
    adminEmail: admin.email,
    eventSlug: event.slug,
  });

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const manageUrl = registrationManagePageUrl(appBaseUrl, event, jwtToken);

  return json({ manageUrl });
}
