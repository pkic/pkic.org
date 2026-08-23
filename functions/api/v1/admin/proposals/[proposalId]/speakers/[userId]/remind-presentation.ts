import type { AdminContext } from "../../../../../../../_lib/db/context";
import type { ValidatedData } from "chanfana";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { adminProposalSpeakerReminderRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import { sendAdminProposalReminder } from "../../../../../../../_lib/routes/admin-proposal-reminders";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  return sendAdminProposalReminder(c, "presentation", c.req.param("userId"));
}

export const AdminProposalSpeakerRemindPresentationPost = openApiRoute(
  adminProposalSpeakerReminderRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof adminProposalSpeakerReminderRouteSchema>) =>
    sendAdminProposalReminder(c, "presentation", data.params.userId, data.params.proposalId),
);
