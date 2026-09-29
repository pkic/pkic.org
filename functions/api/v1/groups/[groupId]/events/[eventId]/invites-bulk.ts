import {
  groupEventAttendeeInviteBulkRouteSchema,
  groupEventAttendeeInvitePreviewRouteSchema,
  groupEventInvitePreviewResponseSchema,
  groupEventSpeakerInviteBulkRouteSchema,
  groupEventSpeakerInvitePreviewRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-event-invites";
import { eventInviteBulkResponseSchema } from "../../../../../../../assets/shared/schemas/event-invite-bulk";
import { requireUserBackedAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import {
  bulkCreateGroupEventAttendeeInvites,
  bulkCreateGroupEventSpeakerInvites,
  previewGroupEventAttendeeInvites,
  previewGroupEventSpeakerInvites,
} from "../../../../../../_lib/services/events/group-invite-bulk";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

function previewResponse(preview: Awaited<ReturnType<typeof previewGroupEventAttendeeInvites>>) {
  return groupEventInvitePreviewResponseSchema.parse({ success: true, ...preview });
}

export const GroupEventAttendeeInvitePreviewPost = openApiRoute(
  groupEventAttendeeInvitePreviewRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const preview = await previewGroupEventAttendeeInvites(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.body,
      resolveAppBaseUrl(c.env, c.req.raw),
      requireInternalSecret(c.env),
    );
    return json(previewResponse(preview));
  },
);

export const GroupEventAttendeeInviteBulkPost = openApiRoute(
  groupEventAttendeeInviteBulkRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await bulkCreateGroupEventAttendeeInvites(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.body,
      resolveAppBaseUrl(c.env, c.req.raw),
      requireInternalSecret(c.env),
    );
    return json(eventInviteBulkResponseSchema.parse({ success: true, ...result }));
  },
);

export const GroupEventSpeakerInvitePreviewPost = openApiRoute(
  groupEventSpeakerInvitePreviewRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const preview = await previewGroupEventSpeakerInvites(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      data.body,
      resolveAppBaseUrl(c.env, c.req.raw),
      requireInternalSecret(c.env),
    );
    return json(previewResponse(preview));
  },
);

export const GroupEventSpeakerInviteBulkPost = openApiRoute(
  groupEventSpeakerInviteBulkRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const result = await bulkCreateGroupEventSpeakerInvites(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      data.body,
      resolveAppBaseUrl(c.env, c.req.raw),
      requireInternalSecret(c.env),
    );
    return json(eventInviteBulkResponseSchema.parse({ success: true, ...result }));
  },
);
