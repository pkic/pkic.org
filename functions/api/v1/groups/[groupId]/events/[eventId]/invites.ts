import {
  groupEventInviteRevokeRouteSchema,
  groupEventInviteResendRouteSchema,
  groupEventInvitesListRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-events";
import {
  eventAttendeeInvitesListResponseSchema,
  eventInviteResendResponseSchema,
} from "../../../../../../../assets/shared/schemas/event-invites";
import { successResponseSchema } from "../../../../../../../assets/shared/schemas/api-common";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  listGroupEventAttendeeInvites,
  resendGroupEventAttendeeInvite,
  revokeGroupEventAttendeeInvite,
} from "../../../../../../_lib/services/events/group-invite-management";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupEventAttendeeInvitesList = openApiRoute(
  groupEventInvitesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await listGroupEventAttendeeInvites(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.query,
    );
    return json(eventAttendeeInvitesListResponseSchema.parse(result));
  },
);

export const GroupEventAttendeeInviteResend = openApiRoute(
  groupEventInviteResendRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await resendGroupEventAttendeeInvite(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.params.inviteId,
      resolveAppBaseUrl(c.env, c.req.raw),
      data.body.expiresAt,
    );
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    return json(eventInviteResendResponseSchema.parse({ success: true, ...result }));
  },
);

export const GroupEventAttendeeInviteRevoke = openApiRoute(
  groupEventInviteRevokeRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    await revokeGroupEventAttendeeInvite(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.params.inviteId,
    );
    return json(successResponseSchema.parse({ success: true }));
  },
);
