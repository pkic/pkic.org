import { requireAdminFromRequest } from "../auth/admin";
import { resolveAppBaseUrl } from "../config";
import { requestDb, type AdminContext } from "../db/context";
import { json } from "../http";
import { sendAdminProposalSpeakerReminders } from "../services/proposal-reminders";
import {
  adminProposalSpeakerReminderResponseSchema,
  adminProposalSpeakerRemindersResponseSchema,
} from "../../../assets/shared/schemas/admin-event-proposals";

export async function sendAdminProposalReminder(
  c: AdminContext,
  kind: "profile" | "presentation",
  userId?: string,
  proposalId = c.req.param("proposalId"),
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const result = await sendAdminProposalSpeakerReminders(db, {
    proposalId,
    userId,
    kind,
    actorUserId: admin.id,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json(
    userId
      ? adminProposalSpeakerReminderResponseSchema.parse({ success: true })
      : adminProposalSpeakerRemindersResponseSchema.parse({ success: true, queued: result.outboxIds.length }),
  );
}
