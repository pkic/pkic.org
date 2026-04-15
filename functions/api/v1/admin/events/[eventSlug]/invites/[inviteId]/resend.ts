import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { first, run } from "../../../../../../../_lib/db/queries";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground, queueEmail } from "../../../../../../../_lib/email/outbox";
import {
  proposalPageUrl,
  registrationPageUrl,
  inviteDeclineUrl,
} from "../../../../../../../_lib/services/frontend-links";
import { refreshInviteToken } from "../../../../../../../_lib/services/invites";
import { addHours, nowIso } from "../../../../../../../_lib/utils/time";

type InviteRow = {
  id: string;
  event_id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
  status: "sent" | "accepted" | "declined" | "expired" | "revoked";
  created_at: string;
};

export async function onRequestPost(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);

  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const invite = await first<InviteRow>(
    c.env.DB,
    `SELECT
       id,
       event_id,
       invitee_email,
       invitee_first_name,
       invitee_last_name,
       invite_type,
       status,
       created_at
     FROM invites
     WHERE id = ? AND event_id = ?
     LIMIT 1`,
    [c.req.param("inviteId"), event.id],
  );

  if (!invite) {
    throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found for this event");
  }

  if (invite.status === "accepted") {
    throw new AppError(409, "INVITE_ALREADY_ACCEPTED", "Cannot resend an invite that was already accepted");
  }

  if (invite.status === "revoked") {
    throw new AppError(409, "INVITE_REVOKED", "Cannot resend a revoked invite");
  }

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const token = await refreshInviteToken(c.env.DB, invite.id);
  const declineUrl = inviteDeclineUrl(appBaseUrl, event, token);

  const now = nowIso();
  const ttlHours = invite.invite_type === "attendee" ? 24 * 14 : 24 * 21;
  const freshExpiry = addHours(now, ttlHours);
  await run(
    c.env.DB,
    `UPDATE invites
     SET
       status = 'sent',
       decline_reason_code = NULL,
       decline_reason_note = NULL,
       declined_at = NULL,
       expires_at = ?,
       last_communication_at = ?
     WHERE id = ?`,
    [freshExpiry, now, invite.id],
  );

  const actionUrl =
    invite.invite_type === "attendee"
      ? registrationPageUrl(appBaseUrl, event, { invite: token, source: "invite_resend" })
      : proposalPageUrl(appBaseUrl, event, { invite: token, source: "speaker_invite_resend" });

  const templateKey = invite.invite_type === "attendee" ? "attendee_invite" : "speaker_invite";
  const subject = invite.invite_type === "attendee" ? `Invitation: ${event.name}` : `Speaker invitation: ${event.name}`;

  const outboxId = await queueEmail(c.env.DB, {
    eventId: event.id,
    templateKey,
    recipientEmail: invite.invitee_email,
    messageType: "transactional",
    subject,
    data: {
      ...buildEventEmailVariables(event, appBaseUrl),
      firstName: invite.invitee_first_name ?? "",
      lastName: invite.invitee_last_name ?? "",
      registrationUrl: invite.invite_type === "attendee" ? actionUrl : undefined,
      proposalUrl: invite.invite_type === "speaker" ? actionUrl : undefined,
      declineUrl,
      isReminder: true,
      reminderCount: "manual",
    },
  });

  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));

  return json({ success: true, inviteId: invite.id, resentAt: now, inviteType: invite.invite_type });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}
