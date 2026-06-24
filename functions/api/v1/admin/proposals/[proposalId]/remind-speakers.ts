/**
 * POST /api/v1/admin/proposals/:proposalId/remind-speakers
 *
 * Sends a speaker profile completion reminder to all confirmed speakers on
 * the proposal. Useful when the operator wants to nudge everyone at once
 * rather than clicking per-speaker.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { refreshSpeakerManageToken } from "../../../../../_lib/services/proposals";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { queueEmail } from "../../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { buildEventEmailVariables } from "../../../../../_lib/services/events";
import { first, all } from "../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{ id: string; title: string; event_id: string }>(
    requestDb(c),
    "SELECT id, title, event_id FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) return json({ error: { message: "Proposal not found" } }, 404);

  const event = await first<any>(requestDb(c), "SELECT * FROM events WHERE id = ?", [proposal.event_id]);
  if (!event) return json({ error: { message: "Event not found" } }, 404);

  const speakers = await all<any>(
    requestDb(c),
    `SELECT ps.id AS proposal_speaker_id, ps.user_id, u.email, u.first_name,
            u.headshot_r2_key, u.biography
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.status = 'confirmed'`,
    [proposalId],
  );

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  let queued = 0;

  for (const speaker of speakers) {
    const freshToken = await refreshSpeakerManageToken(requestDb(c), proposalId, speaker.user_id);
    const profileUrl = speakerManagePageUrl(appBaseUrl, event, freshToken);

    await queueEmail(requestDb(c), {
      eventId: event.id,
      templateKey: "speaker_profile_request",
      recipientEmail: speaker.email,
      recipientUserId: speaker.user_id,
      subject: `Action required: complete your speaker profile — ${event.name}`,
      messageType: "transactional",
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: speaker.first_name ?? "",
        proposalTitle: proposal.title,
        profileUrl,
        hasHeadshot: speaker.headshot_r2_key ? "true" : "",
        hasBio: speaker.biography ? "true" : "",
      },
    });

    await writeAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "speaker_profile_request_resent",
      "proposal_speaker",
      speaker.proposal_speaker_id,
      { proposalId, speakerUserId: speaker.user_id, recipientEmail: speaker.email, bulk: true },
    );

    queued++;
  }

  return json({ success: true, queued });
}
