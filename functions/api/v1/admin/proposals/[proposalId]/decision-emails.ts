import { AppError } from "../../../../../_lib/errors";
import { first } from "../../../../../_lib/db/queries";
import { buildEventEmailVariables, resolveSessionTypes } from "../../../../../_lib/services/events";
import { listProposalSpeakersWithStatus, type ProposalSpeakerWithUser } from "../../../../../_lib/services/proposals";
import { parseJsonSafe } from "../../../../../_lib/utils/json";
import type { DatabaseLike } from "../../../../../_lib/types";

interface EventEmailSource {
  id: string;
  name: string;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
}

interface ProposalEmailSource {
  id: string;
  title: string;
  event_id: string;
  proposer_user_id: string;
  manage_token_hash: string;
  presentation_deadline: string | null;
  proposal_type: string;
}

export interface ProposalDecisionEmailMessage {
  id: string;
  templateKey: "proposal_decision" | "speaker_profile_request" | "presentation_upload_request";
  recipientEmail: string;
  recipientUserId: string;
  recipientLabel: string;
  fallbackSubject: string;
  data: Record<string, unknown>;
}

export interface ProposalDecisionEmailPlan {
  proposal: ProposalEmailSource;
  event: EventEmailSource | null;
  messages: ProposalDecisionEmailMessage[];
  presentationReminderUserIds: string[];
}

function recipientLabel(speaker: ProposalSpeakerWithUser): string {
  const name = [speaker.first_name, speaker.last_name].filter(Boolean).join(" ").trim();
  return name || speaker.email;
}

export async function buildProposalDecisionEmailPlan(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    finalStatus: "accepted" | "rejected" | "needs-work";
    decisionNote?: string;
    presentationDeadline?: string;
  },
  options: {
    appBaseUrl: string;
    resolveSpeakerManageUrl: (speaker: ProposalSpeakerWithUser, event: EventEmailSource) => Promise<string>;
    resolveProposalManageUrl: (event: EventEmailSource, proposalManageToken: string) => Promise<string>;
  },
): Promise<ProposalDecisionEmailPlan> {
  const proposal = await first<ProposalEmailSource>(
    db,
    `SELECT id, title, event_id, proposer_user_id, manage_token_hash, presentation_deadline, proposal_type
     FROM session_proposals
     WHERE id = ?`,
    [payload.proposalId],
  );

  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }

  const [event, speakers] = await Promise.all([
    first<EventEmailSource>(db, "SELECT id, name, slug, base_path, starts_at, settings_json FROM events WHERE id = ?", [
      proposal.event_id,
    ]),
    listProposalSpeakersWithStatus(db, payload.proposalId),
  ]);

  const messages: ProposalDecisionEmailMessage[] = [];
  const presentationReminderUserIds = new Set<string>();
  const proposalManageUrl = event ? await options.resolveProposalManageUrl(event, proposal.manage_token_hash) : "";

  const eventSettings = parseJsonSafe<{ proposal?: { sessionTypes?: unknown[] } }>(event?.settings_json ?? "{}", {});
  const sessionTypes = resolveSessionTypes(eventSettings);
  const sessionTypeConfig = sessionTypes.find(
    (t) => t.label.toLowerCase() === proposal.proposal_type.toLowerCase(),
  );
  const requiresPresentation = sessionTypeConfig?.requiresPresentation ?? false;

  for (const speaker of speakers) {
    if (speaker.user_id === proposal.proposer_user_id) {
      messages.push({
        id: `proposal-decision:${speaker.user_id}`,
        templateKey: "proposal_decision",
        recipientEmail: speaker.email,
        recipientUserId: speaker.user_id,
        recipientLabel: recipientLabel(speaker),
        fallbackSubject: `Proposal update: ${proposal.title}`,
        data: {
          ...(event ? buildEventEmailVariables(event, options.appBaseUrl) : {}),
          eventName: event?.name ?? "",
          firstName: speaker.first_name ?? "",
          lastName: speaker.last_name ?? "",
          proposalTitle: proposal.title,
          manageUrl: proposalManageUrl,
          finalStatus: payload.finalStatus,
          decisionNote: payload.decisionNote ?? "",
        },
      });
    }

    if (payload.finalStatus === "accepted" && event && speaker.status !== "declined") {
      const manageUrl = await options.resolveSpeakerManageUrl(speaker, event);
      const eventVars = buildEventEmailVariables(event, options.appBaseUrl);

      messages.push({
        id: `speaker-profile:${speaker.user_id}`,
        templateKey: "speaker_profile_request",
        recipientEmail: speaker.email,
        recipientUserId: speaker.user_id,
        recipientLabel: recipientLabel(speaker),
        fallbackSubject: `Action required: complete your speaker profile — ${event.name}`,
        data: {
          ...eventVars,
          firstName: speaker.first_name ?? "",
          proposalTitle: proposal.title,
          profileUrl: manageUrl,
          hasHeadshot: speaker.headshot_r2_key ? "true" : "",
          hasBio: speaker.biography ? "true" : "",
        },
      });

      if (requiresPresentation) {
        messages.push({
          id: `presentation-upload:${speaker.user_id}`,
          templateKey: "presentation_upload_request",
          recipientEmail: speaker.email,
          recipientUserId: speaker.user_id,
          recipientLabel: recipientLabel(speaker),
          fallbackSubject: `Please upload your presentation — ${event.name}`,
          data: {
            ...eventVars,
            firstName: speaker.first_name ?? "",
            proposalTitle: proposal.title,
            uploadUrl: manageUrl,
            deadline: proposal.presentation_deadline ?? payload.presentationDeadline ?? "",
          },
        });
        presentationReminderUserIds.add(speaker.user_id);
      }
    }
  }

  return {
    proposal,
    event,
    messages,
    presentationReminderUserIds: Array.from(presentationReminderUserIds),
  };
}
