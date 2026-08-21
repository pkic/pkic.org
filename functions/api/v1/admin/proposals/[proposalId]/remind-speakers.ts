import type { AdminContext } from "../../../../../_lib/db/context";
import { sendAdminProposalReminder } from "../../../../../_lib/routes/admin-proposal-reminders";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  return sendAdminProposalReminder(c, "profile");
}
