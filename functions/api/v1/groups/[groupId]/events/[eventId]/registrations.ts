import {
  groupEventRegistrationCreateRouteSchema,
  groupEventRegistrationAdmissionCreateRouteSchema,
  groupEventRegistrationDayAttendancePatchRouteSchema,
  groupEventRegistrationDetailRouteSchema,
  groupEventRegistrationsListRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-events";
import { eventAttendanceRegistrationsListResponseSchema } from "../../../../../../../assets/shared/schemas/event-registrations";
import {
  eventRegistrationAdmitResponseSchema,
  eventRegistrationAttendanceDetailResponseSchema,
  eventRegistrationDayAttendanceResponseSchema,
} from "../../../../../../../assets/shared/schemas/event-registration-detail";
import { registrationSubmissionResponseSchema } from "../../../../../../../assets/shared/schemas/registration";
import { getConfig, resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getClientIp, getUserAgent, requireInternalSecret } from "../../../../../../_lib/request";
import { submitGroupEventRegistration } from "../../../../../../_lib/services/events/group-registration";
import { listGroupManagedEventRegistrations } from "../../../../../../_lib/services/events/group-management";
import {
  admitGroupManagedEventRegistration,
  getGroupManagedEventRegistration,
  updateGroupManagedEventRegistrationDayAttendance,
} from "../../../../../../_lib/services/registrations/group-attendee-management";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
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
      eventAttendanceRegistrationsListResponseSchema.parse({
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

export const GroupEventRegistrationDetailGet = openApiRoute(
  groupEventRegistrationDetailRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await getGroupManagedEventRegistration(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.params.registrationId,
    );
    return json(eventRegistrationAttendanceDetailResponseSchema.parse(result));
  },
);

export const GroupEventRegistrationDayAttendancePatch = openApiRoute(
  groupEventRegistrationDayAttendancePatchRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await updateGroupManagedEventRegistrationDayAttendance(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.params.registrationId,
      data.body,
      resolveAppBaseUrl(c.env, c.req.raw),
    );
    if (result.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    }
    return json(eventRegistrationDayAttendanceResponseSchema.parse({ success: true }));
  },
);

export const GroupEventRegistrationAdmissionCreate = openApiRoute(
  groupEventRegistrationAdmissionCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await admitGroupManagedEventRegistration(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.params.registrationId,
      data.body,
      resolveAppBaseUrl(c.env, c.req.raw),
    );
    if (result.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    }
    return json(
      eventRegistrationAdmitResponseSchema.parse({
        success: true,
        registration: result.registration,
        admittedDayDates: result.admittedDayDates,
      }),
    );
  },
);
