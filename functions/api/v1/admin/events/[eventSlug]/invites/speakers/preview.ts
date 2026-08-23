import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { buildAdminInvitePreview } from "../../../../../../../_lib/services/admin-invite-preview-email";
import {
  adminSpeakerInvitePreviewResponseSchema,
  adminSpeakerInvitePreviewRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-admin-event-communications";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";

export const AdminEventsEventSlugInvitesSpeakersPreviewPost = openApiRoute(
  adminSpeakerInvitePreviewRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const body = data.body;
    const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
    const preview = await buildAdminInvitePreview({
      db: requestDb(c),
      event,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      signingSecret: requireInternalSecret(c.env),
      adminId: admin.id,
      inviteType: "speaker",
      invites: body.invites,
    });
    return json(adminSpeakerInvitePreviewResponseSchema.parse({ success: true, ...preview }));
  },
);
