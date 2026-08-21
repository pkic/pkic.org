import type { ProposalDecisionStatus } from "../../../../assets/shared/schemas/proposal-status";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { buildEventEmailVariables, resolveEventSessionTypes } from "../events";
import { listProposalSpeakersWithStatus, type ProposalSpeakerWithUser } from "../proposal-speakers";
import type { ProposalDecisionEmailMessage, ProposalDecisionEmailPlan } from "./types";
import { assertProposalDecisionStateAllowed, assertProposalFinalizeAccess } from "./context";
import { snapshotProposalDecisionSpeaker } from "./snapshot";

interface EventEmailSource {
  id: string;
  name: string;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
}

type ProposalEmailSource = ProposalDecisionEmailPlan["proposal"];

function recipientLabel(speaker: ProposalSpeakerWithUser): string {
  const name = [speaker.first_name, speaker.last_name].filter(Boolean).join(" ").trim();
  return name || speaker.email;
}

export async function buildProposalDecisionEmailPlan(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    actor: AuthAdmin;
    finalStatus: ProposalDecisionStatus;
    decisionNote?: string;
    presentationDeadline?: string;
  },
  options: {
    appBaseUrl: string;
    resolveSpeakerManageUrl: (speaker: ProposalSpeakerWithUser, event: EventEmailSource) => Promise<string>;
    resolveProposalManageUrl: (event: EventEmailSource, proposalId: string) => Promise<string>;
  },
): Promise<ProposalDecisionEmailPlan> {
  const proposal = await first<ProposalEmailSource>(
    db,
    `SELECT sp.id, sp.title, sp.event_id, sp.proposer_user_id, sp.presentation_deadline,
            sp.proposal_type, sp.status, sp.updated_at,
            pd.id AS current_decision_id, pd.final_status AS current_decision_status
     FROM session_proposals sp
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [payload.proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  assertProposalDecisionStateAllowed(proposal, payload.finalStatus);
  await assertProposalFinalizeAccess(db, proposal.event_id, payload.actor);

  const event = await first<EventEmailSource>(
    db,
    "SELECT id, name, slug, base_path, starts_at, settings_json FROM events WHERE id = ?",
    [proposal.event_id],
  );
  if (!event) throw new AppError(409, "PROPOSAL_EVENT_NOT_FOUND", "The proposal event no longer exists");
  const speakers = await listProposalSpeakersWithStatus(db, payload.proposalId);

  const messages: ProposalDecisionEmailMessage[] = [];
  const presentationReminderUserIds = new Set<string>();
  const proposalManageUrl = await options.resolveProposalManageUrl(event, proposal.id);
  const sessionTypeConfig = resolveEventSessionTypes(event.settings_json).find(
    (sessionType) => sessionType.label.toLowerCase() === proposal.proposal_type.toLowerCase(),
  );

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
          ...buildEventEmailVariables(event, options.appBaseUrl),
          proposalId: proposal.id,
          speakerUserId: speaker.user_id,
          eventName: event.name,
          firstName: speaker.first_name ?? "",
          lastName: speaker.last_name ?? "",
          proposalTitle: proposal.title,
          manageUrl: proposalManageUrl,
          finalStatus: payload.finalStatus,
          decisionNote: payload.decisionNote ?? "",
        },
      });
    }

    if (payload.finalStatus !== "accepted" || speaker.status === "declined") continue;
    const manageUrl = await options.resolveSpeakerManageUrl(speaker, event);
    const eventVariables = buildEventEmailVariables(event, options.appBaseUrl);
    messages.push({
      id: `speaker-profile:${speaker.user_id}`,
      templateKey: "speaker_profile_request",
      recipientEmail: speaker.email,
      recipientUserId: speaker.user_id,
      recipientLabel: recipientLabel(speaker),
      fallbackSubject: `Action required: complete your speaker profile — ${event.name}`,
      data: {
        ...eventVariables,
        proposalId: proposal.id,
        speakerUserId: speaker.user_id,
        firstName: speaker.first_name ?? "",
        proposalTitle: proposal.title,
        profileUrl: manageUrl,
        hasHeadshot: speaker.headshot_r2_key ? "true" : "",
        hasBio: speaker.biography ? "true" : "",
      },
    });

    if (!sessionTypeConfig?.requiresPresentation) continue;
    messages.push({
      id: `presentation-upload:${speaker.user_id}`,
      templateKey: "presentation_upload_request",
      recipientEmail: speaker.email,
      recipientUserId: speaker.user_id,
      recipientLabel: recipientLabel(speaker),
      fallbackSubject: `Please upload your presentation — ${event.name}`,
      data: {
        ...eventVariables,
        proposalId: proposal.id,
        speakerUserId: speaker.user_id,
        firstName: speaker.first_name ?? "",
        proposalTitle: proposal.title,
        uploadUrl: manageUrl,
        deadline: payload.presentationDeadline ?? proposal.presentation_deadline ?? "",
      },
    });
    presentationReminderUserIds.add(speaker.user_id);
  }

  return {
    proposal,
    eventSnapshot: {
      name: event.name,
      slug: event.slug,
      basePath: event.base_path,
      startsAt: event.starts_at,
      settingsJson: event.settings_json,
    },
    speakerSnapshot: speakers.map(snapshotProposalDecisionSpeaker),
    messages,
    presentationReminderUserIds: [...presentationReminderUserIds],
  };
}
