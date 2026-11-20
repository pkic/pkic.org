import { json } from "../../../../_lib/http";
import { findInviteByToken } from "../../../../_lib/services/invites";
import { updateInviteReminderPreference } from "../../../../_lib/services/invite-reminder-preference";
import { inviteReminderPreferenceRouteSchema } from "../../../../../assets/shared/schemas/invites";
import { requireInternalSecret } from "../../../../_lib/request";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";

export const InviteRemindersPost = openApiRoute(
  inviteReminderPreferenceRouteSchema,
  async (c: AdminContext, data) => {
    c.set?.("sensitive", true);
    const invite = await findInviteByToken(
      c.env.DB,
      data.params.token,
      requireInternalSecret(c.env),
      data.query.id ?? null,
    );
    return json({ success: true, ...(await updateInviteReminderPreference(c.env.DB, invite, data.body.action)) });
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
