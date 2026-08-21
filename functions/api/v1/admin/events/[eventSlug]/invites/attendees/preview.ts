import { parseJsonBody } from "../../../../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { buildAdminInvitePreview } from "../../../../../../../_lib/services/admin-invite-preview-email";
import { adminBulkAttendeeInvitesPreviewSchema } from "../../../../../../../../assets/shared/schemas/admin-events";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminBulkAttendeeInvitesPreviewSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const secret = requireInternalSecret(c.env);

  const preview = await buildAdminInvitePreview({
    db: requestDb(c),
    event,
    appBaseUrl,
    signingSecret: secret,
    adminId: admin.id,
    inviteType: "attendee",
    invites: body.invites,
  });

  return json({
    success: true,
    ...preview,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
