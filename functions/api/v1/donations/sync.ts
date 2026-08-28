import { donationSyncPostRouteSchema } from "../../../../assets/shared/schemas/donation-management";
import { resolveAppBaseUrl } from "../../../_lib/config";
import type { AdminContext } from "../../../_lib/db/context";
import { processSelectedOutboxBackground } from "../../../_lib/email/outbox";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { reconcileDonations } from "../../../_lib/services/donations/reconciliation";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";

const DEFAULT_RECONCILIATION_LIMIT = 50;

export const DonationsSyncPost = openApiRoute(donationSyncPostRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "donations:sync");
  if (!c.env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "NOT_CONFIGURED", "STRIPE_SECRET_KEY is not configured");
  }

  const reconciled = await reconcileDonations(db, c.env, data.body, {
    actor: staff,
    stripeKey: c.env.STRIPE_SECRET_KEY,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    limit: DEFAULT_RECONCILIATION_LIMIT,
  });
  if (reconciled.outboxIds.length > 0) {
    c.executionCtx.waitUntil(processSelectedOutboxBackground(db, c.env, reconciled.outboxIds));
  }
  return json(reconciled.response);
});
