/**
 * POST /api/v1/admin/mailing-lists/sync — process pending Google Group sync
 * queue entries on demand. The queue is normally drained by the
 * 15-minute due-work cron (membership-scheduled-jobs.ts's
 * runGoogleGroupsSyncPass); this gives staff an on-demand "Sync now" button
 * instead of waiting on the next cron tick.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { processGoogleGroupsSyncQueue } from "../../../../_lib/services/google-groups";
import { mailingListSyncRouteSchema } from "../../../../../assets/shared/schemas/admin-mailing-lists";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MailingListsSync = openApiRoute(mailingListSyncRouteSchema, async (c: AdminContext, _data) => {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  const result = await processGoogleGroupsSyncQueue(db, c.env);
  return json({
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    skippedUnconfigured: result.skippedUnconfigured,
  });
});
