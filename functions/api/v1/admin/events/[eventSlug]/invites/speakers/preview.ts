import { parseJsonBody } from "../../../../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { buildAdminInvitePreview } from "../../../../../../../_lib/services/admin-invite-preview-email";
import {
  adminSpeakerInvitePreviewResponseSchema,
  adminSpeakerInvitePreviewRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-admin-event-communications";
import { adminBulkSpeakerInvitesPreviewSchema } from "../../../../../../../../assets/shared/schemas/admin-events";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";

export async function onRequestPost(
  c: AdminContext,
  validated?: ValidatedData<typeof adminSpeakerInvitePreviewRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = validated?.body ?? (await parseJsonBody(c.req, adminBulkSpeakerInvitesPreviewSchema));
  const event = await getEventBySlug(requestDb(c), validated?.params.eventSlug ?? c.req.param("eventSlug"));
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
}

export const AdminEventsEventSlugInvitesSpeakersPreviewPost = openApiRoute(
  adminSpeakerInvitePreviewRouteSchema,
  onRequestPost,
);

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
