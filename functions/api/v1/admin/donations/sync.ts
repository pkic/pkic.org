import { donationSyncPostRouteSchema } from "../../../../../assets/shared/schemas/admin-donations";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { processSelectedOutboxBackground } from "../../../../_lib/email/outbox";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { reconcileDonations } from "../../../../_lib/services/donations/reconciliation";

const DEFAULT_RECONCILIATION_LIMIT = 50;

export const AdminDonationsSyncPost = openApiRoute(donationSyncPostRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  if (!c.env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "NOT_CONFIGURED", "STRIPE_SECRET_KEY is not configured");
  }

  const reconciled = await reconcileDonations(db, c.env, data.body, {
    stripeKey: c.env.STRIPE_SECRET_KEY,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    limit: DEFAULT_RECONCILIATION_LIMIT,
  });
  if (reconciled.outboxIds.length > 0) {
    c.executionCtx.waitUntil(processSelectedOutboxBackground(db, c.env, reconciled.outboxIds));
  }
  return json(reconciled.response);
});
