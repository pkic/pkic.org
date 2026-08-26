import {
  groupEventRegistrationCreateRouteSchema,
  groupEventRegistrationsListRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-events";
import { eventRegistrationsListResponseSchema } from "../../../../../../../assets/shared/schemas/event-registrations";
import { registrationSubmissionResponseSchema } from "../../../../../../../assets/shared/schemas/registration";
import { getConfig, resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getClientIp, getUserAgent, requireInternalSecret } from "../../../../../../_lib/request";
import { submitGroupEventRegistration } from "../../../../../../_lib/services/events/group-registration";
import { listGroupManagedEventRegistrations } from "../../../../../../_lib/services/events/group-management";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupEventRegistrationCreate = openApiRoute(
  groupEventRegistrationCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const request = c.req.raw;
    const { group, viewer } = await requireGroupResourceContext(db, request, c.env, data.params.groupId);
    const config = getConfig(c.env, request);
    const result = await submitGroupEventRegistration(db, c.env, viewer, group.id, data.params.eventId, data.body, {
      clientIp: getClientIp(request),
      userAgent: getUserAgent(request),
      appBaseUrl: resolveAppBaseUrl(c.env, request),
      signingSecret: requireInternalSecret(c.env),
      config: {
        maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
        pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
        confirmationLinkTtlHours: config.confirmationLinkTtlHours,
        referralCodeLength: config.referralCodeLength,
      },
    });
    for (const task of result.backgroundTasks) c.executionCtx.waitUntil(task);
    return json(registrationSubmissionResponseSchema.parse(result.response));
  },
);

export const GroupEventRegistrationsList = openApiRoute(
  groupEventRegistrationsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const { event, result } = await listGroupManagedEventRegistrations(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.query,
    );
    return json(
      eventRegistrationsListResponseSchema.parse({
        event,
        registrations: result.registrations,
        stats: result.stats,
        page: {
          limit: data.query.limit,
          offset: data.query.offset,
          total: result.total,
          hasMore: data.query.offset + result.registrations.length < result.total,
        },
      }),
    );
  },
);
