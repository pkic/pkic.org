/**
 * POST /api/v1/admin/events/:eventSlug/registrations/:registrationId/regenerate-badge
 *
 * Purges the cached OG badge for a specific registration from R2 and
 * re-renders it in the background (via context.waitUntil).
 *
 * Use this when a badge becomes stale — e.g. after a headshot update that
 * didn't auto-invalidate, or after a role change, or to force a fresh render
 * following any data correction.
 *
 * The response returns immediately; badge generation continues in the background
 * (typically 1–3 seconds). Refresh the View Badge link after a few seconds.
 */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { first } from "../../../../../../../_lib/db/queries";
import { prerenderAndCache } from "../../../../../../../_lib/services/og-badge-prerender";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import type { PagesContext } from "../../../../../../../_lib/types";

const R2_KEY_PREFIX = "og-badges/";

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string; registrationId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const appBaseUrl = resolveAppBaseUrl(context.env);

  // Look up the referral code owned by this registration
  const row = await first<{ code: string }>(
    context.env.DB,
    `SELECT code FROM referral_codes
     WHERE owner_type = 'registration'
       AND owner_id   = ?
       AND event_id   = ?
     LIMIT 1`,
    [context.params.registrationId, event.id],
  );

  if (!row) {
    return json(
      { error: { code: "NO_REFERRAL_CODE", message: "No referral code found for this registration" } },
      404,
    );
  }

  // Purge the cached OG badge from R2 so it will be re-rendered fresh.
  if (context.env.ASSETS_BUCKET) {
    const bucket = context.env.ASSETS_BUCKET as unknown as { delete(key: string): Promise<void> };
    await bucket.delete(`${R2_KEY_PREFIX}${row.code}`);
  }

  // Await synchronously so the badge is ready before we respond — the admin UI
  // opens the badge URL immediately on success, so background-queue isn't safe here.
  await prerenderAndCache(row.code, context.env, appBaseUrl);

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "og_badge_regenerated",
    "registration",
    context.params.registrationId,
    { referralCode: row.code },
  );

  const badgeUrl = `${appBaseUrl}/api/v1/og/${row.code}`;
  return json({ success: true, referralCode: row.code, badgeUrl });
}
