import {
  operationsRemindersPreviewRouteSchema,
  operationsRemindersRunResponseSchema,
} from "../../../../../assets/shared/schemas/operations";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { runReminderCycle } from "../../../../_lib/services/reminders";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const OperationsRemindersPreviewPost = openApiRoute(
  operationsRemindersPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "operations:read");
    const config = getConfig(c.env, c.req.raw);
    const result = await runReminderCycle(db, {
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      reminderIntervalDays: config.reminderIntervalDays,
      pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
      confirmationLinkTtlHours: config.confirmationLinkTtlHours,
      maxInviteReminders: config.maxInviteReminders,
      maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
      maxPresentationReminders: config.maxPresentationReminders,
      presentationReminderLeadDays: config.presentationReminderLeadDays,
      limit: data.body.limit,
      dryRun: true,
    });
    return json(operationsRemindersRunResponseSchema.parse({ success: true, dryRun: true, ...result }));
  },
);
