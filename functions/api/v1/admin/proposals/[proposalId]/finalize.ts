import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import {
  finalizeProposalDecision,
  listProposalSpeakersWithStatus,
  refreshSpeakerManageToken,
} from "../../../../../_lib/services/proposals";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { processPendingOutboxBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { first, run } from "../../../../../_lib/db/queries";
import { speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { buildEventEmailVariables } from "../../../../../_lib/services/events";
import { finalizeProposalSchema } from "../../../../../../assets/shared/schemas/api";

export async function onRequestPost(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const proposalId = c.req.param("proposalId");

  const accessCheckProposal = await first<{ event_id: string }>(
    c.env.DB,
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!accessCheckProposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(c.env.DB, accessCheckProposal.event_id, admin);
  if (!access.canFinalize) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to finalize proposals" } }, 403);
  }

  const body = await parseJsonBody(c.req, finalizeProposalSchema);
  const config = getConfig(c.env, c.req.raw);

  const minReviewsRequired = config.minProposalReviews;

  const finalized = await finalizeProposalDecision(c.env.DB, {
    proposalId,
    decidedByUserId: admin.id,
    finalStatus: body.finalStatus,
    decisionNote: body.decisionNote,
    minReviewsRequired,
  });

  // Store the presentation deadline on the proposal when accepting.
  if (body.finalStatus === "accepted" && body.presentationDeadline) {
    await run(
      c.env.DB,
      "UPDATE session_proposals SET presentation_deadline = ?, updated_at = datetime('now') WHERE id = ?",
      [body.presentationDeadline, proposalId],
    );
  }

  const proposal = await first<{
    title: string;
    event_id: string;
    proposer_user_id: string;
    presentation_deadline: string | null;
  }>(c.env.DB, "SELECT title, event_id, proposer_user_id, presentation_deadline FROM session_proposals WHERE id = ?", [
    proposalId,
  ]);

  if (proposal) {
    const [event, speakers] = await Promise.all([
      first<{
        id: string;
        name: string;
        slug: string;
        base_path: string | null;
        starts_at: string | null;
        settings_json: string;
      }>(c.env.DB, "SELECT id, name, slug, base_path, starts_at, settings_json FROM events WHERE id = ?", [
        proposal.event_id,
      ]),
      listProposalSpeakersWithStatus(c.env.DB, proposalId),
    ]);

    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

    for (const speaker of speakers) {
      // Decision email to the proposer only.
      if (speaker.user_id === proposal.proposer_user_id) {
        await queueEmail(c.env.DB, {
          eventId: proposal.event_id,
          templateKey: "proposal_decision",
          recipientEmail: speaker.email,
          recipientUserId: speaker.user_id,
          subject: `Proposal update: ${proposal.title}`,
          messageType: "transactional",
          data: {
            ...(event ? buildEventEmailVariables(event, appBaseUrl) : {}),
            eventName: event?.name ?? "",
            firstName: speaker.first_name ?? "",
            lastName: speaker.last_name ?? "",
            proposalTitle: proposal.title,
            finalStatus: body.finalStatus,
            decisionNote: body.decisionNote ?? "",
          },
        });
      }

      // On acceptance, ask all confirmed/invited speakers to complete their profile
      // and upload a headshot, and to upload their presentation slides.
      if (body.finalStatus === "accepted" && event) {
        const isActive = speaker.status !== "declined";

        if (isActive) {
          // Refresh the speaker's manage token so the acceptance emails contain valid links.
          const freshToken = await refreshSpeakerManageToken(c.env.DB, proposalId, speaker.user_id);
          const speakerManageUrl = speakerManagePageUrl(appBaseUrl, event, freshToken);

          await queueEmail(c.env.DB, {
            eventId: proposal.event_id,
            templateKey: "speaker_profile_request",
            recipientEmail: speaker.email,
            recipientUserId: speaker.user_id,
            subject: `Action required: complete your speaker profile — ${event.name}`,
            messageType: "transactional",
            data: {
              ...buildEventEmailVariables(event, appBaseUrl),
              firstName: speaker.first_name ?? "",
              proposalTitle: proposal.title,
              profileUrl: speakerManageUrl,
              hasHeadshot: speaker.headshot_r2_key ? "true" : "",
              hasBio: speaker.biography ? "true" : "",
            },
          });

          await queueEmail(c.env.DB, {
            eventId: proposal.event_id,
            templateKey: "presentation_upload_request",
            recipientEmail: speaker.email,
            recipientUserId: speaker.user_id,
            subject: `Please upload your presentation — ${event.name}`,
            messageType: "transactional",
            data: {
              ...buildEventEmailVariables(event, appBaseUrl),
              firstName: speaker.first_name ?? "",
              proposalTitle: proposal.title,
              uploadUrl: speakerManageUrl,
              deadline: proposal.presentation_deadline ?? body.presentationDeadline ?? "",
            },
          });

          await run(
            c.env.DB,
            `UPDATE proposal_speakers
             SET presentation_last_communication_at = ?,
                 presentation_reminders_paused_until = NULL
             WHERE proposal_id = ? AND user_id = ?`,
            [new Date().toISOString(), proposalId, speaker.user_id],
          );
        }
      }
    }

    c.executionCtx.waitUntil(processPendingOutboxBackground(c.env.DB, c.env, 5));
  }

  return json({ success: true, ...finalized, minReviewsRequired });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
