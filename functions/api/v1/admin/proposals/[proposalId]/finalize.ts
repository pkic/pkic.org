import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import {
  finalizeProposalDecision,
  listProposalSpeakersWithStatus,
  refreshSpeakerManageToken,
} from "../../../../../_lib/services/proposals";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { processPendingOutboxBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { first, run } from "../../../../../_lib/db/queries";
import { speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import type { PagesContext } from "../../../../../_lib/types";
import { finalizeProposalSchema } from "../../../../../../shared/schemas/api";

export async function onRequestPost(
  context: PagesContext<{ proposalId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request);
  const body = await parseJsonBody(context.request, finalizeProposalSchema);
  const config = getConfig(context.env, context.request);

  const minReviewsRequired = body.minReviewsRequired ?? config.minProposalReviews;

  const finalized = await finalizeProposalDecision(context.env.DB, {
    proposalId: context.params.proposalId,
    decidedByUserId: admin.id,
    finalStatus: body.finalStatus,
    decisionNote: body.decisionNote,
    minReviewsRequired,
  });

  // Store the presentation deadline on the proposal when accepting.
  if (body.finalStatus === "accepted" && body.presentationDeadline) {
    await run(
      context.env.DB,
      "UPDATE session_proposals SET presentation_deadline = ?, updated_at = datetime('now') WHERE id = ?",
      [body.presentationDeadline, context.params.proposalId],
    );
  }

  const proposal = await first<{
    title: string;
    event_id: string;
    proposer_user_id: string;
    presentation_deadline: string | null;
  }>(
    context.env.DB,
    "SELECT title, event_id, proposer_user_id, presentation_deadline FROM session_proposals WHERE id = ?",
    [context.params.proposalId],
  );

  if (proposal) {
    const [event, speakers] = await Promise.all([
      first<{ id: string; name: string; slug: string; base_path: string | null; starts_at: string | null; settings_json: string }>(
        context.env.DB,
        "SELECT id, name, slug, base_path, starts_at, settings_json FROM events WHERE id = ?",
        [proposal.event_id],
      ),
      listProposalSpeakersWithStatus(context.env.DB, context.params.proposalId),
    ]);

    const appBaseUrl = resolveAppBaseUrl(context.env, context.request);

    for (const speaker of speakers) {
      // Decision email to the proposer only.
      if (speaker.user_id === proposal.proposer_user_id) {
        await queueEmail(context.env.DB, {
          eventId: proposal.event_id,
          templateKey: "proposal_decision",
          recipientEmail: speaker.email,
          recipientUserId: speaker.user_id,
          subject: `Proposal update: ${proposal.title}`,
          messageType: "transactional",
          data: {
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
          const freshToken = await refreshSpeakerManageToken(
            context.env.DB,
            context.params.proposalId,
            speaker.user_id,
          );
          const speakerManageUrl = speakerManagePageUrl(appBaseUrl, event, freshToken);

          await queueEmail(context.env.DB, {
            eventId: proposal.event_id,
            templateKey: "speaker_profile_request",
            recipientEmail: speaker.email,
            recipientUserId: speaker.user_id,
            subject: `Action required: complete your speaker profile — ${event.name}`,
            messageType: "transactional",
            data: {
              eventName: event.name,
              firstName: speaker.first_name ?? "",
              proposalTitle: proposal.title,
              profileUrl: speakerManageUrl,
              hasHeadshot: speaker.headshot_r2_key ? "true" : "",
              hasBio: speaker.biography ? "true" : "",
            },
          });

          await queueEmail(context.env.DB, {
            eventId: proposal.event_id,
            templateKey: "presentation_upload_request",
            recipientEmail: speaker.email,
            recipientUserId: speaker.user_id,
            subject: `Please upload your presentation — ${event.name}`,
            messageType: "transactional",
            data: {
              eventName: event.name,
              firstName: speaker.first_name ?? "",
              proposalTitle: proposal.title,
              uploadUrl: speakerManageUrl,
              deadline: proposal.presentation_deadline ?? body.presentationDeadline ?? "",
            },
          });
        }
      }
    }

    context.waitUntil(processPendingOutboxBackground(context.env.DB, context.env, 5));
  }

  return json({ success: true, ...finalized, minReviewsRequired });
}

export async function onRequest(context: PagesContext<{ proposalId: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
