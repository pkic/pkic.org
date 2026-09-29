import { requireAdminFromRequest } from "../auth/admin";
import { resolveAppBaseUrl } from "../config";
import { requestDb, type AdminContext } from "../db/context";
import { json } from "../http";
import { sendProposalSpeakerReminders } from "../services/proposal-reminders";
import {
  proposalSpeakerReminderResponseSchema,
  proposalSpeakerRemindersResponseSchema,
} from "../../../assets/shared/schemas/proposal-speakers";

export async function sendProposalReminder(
  c: AdminContext,
  kind: "profile" | "presentation",
  userId?: string,
  proposalId = c.req.param("proposalId"),
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const result = await sendProposalSpeakerReminders(db, {
    proposalId,
    userId,
    kind,
    actor: admin,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json(
    userId
      ? proposalSpeakerReminderResponseSchema.parse({ success: true })
      : proposalSpeakerRemindersResponseSchema.parse({ success: true, queued: result.outboxIds.length }),
  );
}
