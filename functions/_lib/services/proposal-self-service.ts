import type { ParticipantAuthority } from "./participant-authority";
import type { z } from "zod";
import type {
  proposalAccessPatchResponseSchema,
  proposalAccessPatchSchema,
  proposalAccessReadResponseSchema,
} from "../../../assets/shared/schemas/proposal-management";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { proposalRevisionRequestSchema } from "../../../assets/shared/schemas/proposal-management";
import type { DatabaseLike } from "../types";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import {
  prepareReplaceContextFormSubmission,
  toEventFormResolutionEvent,
  validateCustomAnswersForSubmission,
} from "./forms";
import { readProposalRevisionDraft, withProposalRevisionDraft } from "./proposal-revision-draft";
import { listProposalSpeakersWithStatus, type ProposalSpeakerWithUser } from "./proposal-speakers";
import { getProposalByManageToken, type ProposalRecord, updateProposalForVerifiedOwner } from "./proposals";
import { getEventById, requireConfiguredSessionType } from "./events";
import { proposalAccessPath } from "../../../assets/shared/proposal-access-paths";
import { proposalActingIdentityReadModel } from "./proposal-speaker-identity";

type ProposalAccessInput = z.infer<typeof proposalAccessPatchSchema>;
type ProposalAccessReadResponse = z.infer<typeof proposalAccessReadResponseSchema>;
type ProposalAccessPatchResponse = z.infer<typeof proposalAccessPatchResponseSchema>;

function toAccessibleProposal(stored: ProposalRecord): ProposalAccessPatchResponse["proposal"] {
  const proposal = withProposalRevisionDraft(stored);
  return {
    id: proposal.id,
    event_id: proposal.event_id,
    proposer_user_id: proposal.proposer_user_id,
    status: proposal.status,
    proposal_type: proposal.proposal_type,
    title: proposal.title,
    abstract: proposal.abstract,
    committee_notes: proposal.committee_notes ?? null,
    details: parseJsonSafe<Record<string, unknown> | null>(proposal.details_json, null),
    revision_request: proposalRevisionRequestSchema
      .nullable()
      .parse(parseJsonSafe(proposal.revision_request_json, null)),
  };
}

export async function loadProposalAccessView(
  db: DatabaseLike,
  input: { token: ParticipantAuthority; signingSecret: string; appBaseUrl: string },
): Promise<ProposalAccessReadResponse> {
  const proposal = await getProposalByManageToken(db, input.token, input.signingSecret);
  const speakers = await listProposalSpeakersWithStatus(db, proposal.id);

  return {
    success: true,
    proposal: toAccessibleProposal(proposal),
    speakers: speakers.map((speaker) => {
      const status = {
        ...proposalActingIdentityReadModel(speaker),
        userId: speaker.user_id,
        role: speaker.role,
        status: speaker.status,
        confirmedAt: speaker.confirmed_at,
        declinedAt: speaker.declined_at,
        declineReason: speaker.status === "declined" ? speaker.decline_reason : null,
        email: speaker.status === "confirmed" ? speaker.email : (speaker.invited_email ?? speaker.email),
      };
      if (speaker.status !== "confirmed" && speaker.user_id !== proposal.proposer_user_id)
        return invitedSpeakerView(status, speaker);
      return {
        ...status,
        firstName: speaker.first_name,
        lastName: speaker.last_name,
        organizationName: speaker.organization_name,
        jobTitle: speaker.job_title,
        bio: speaker.biography,
        links: parseLinksJson(speaker.links_json),
        headshotUploaded: Boolean(speaker.headshot_r2_key),
        headshotUpdatedAt: speaker.headshot_updated_at,
        headshotUrl: speaker.headshot_r2_key
          ? `${proposalAccessPath(input.appBaseUrl + "/api/v1", input.token, "speakers", speaker.user_id, "headshot")}?v=${encodeURIComponent(speaker.headshot_updated_at ?? "")}`
          : null,
      };
    }),
  };
}

/**
 * Until a speaker accepts, the proposer sees only who they invited: the address they typed, and the name only
 * on an account no one has claimed (the name a proposer typed). An existing person's profile and primary
 * address stay theirs, also after they decline. The proposer's own speaker profile is already theirs to see.
 */
function invitedSpeakerView<T extends object>(status: T, speaker: ProposalSpeakerWithUser) {
  const typedName = !speaker.account_claimed;
  return {
    ...status,
    firstName: typedName ? speaker.first_name : null,
    lastName: typedName ? speaker.last_name : null,
    organizationName: null,
    jobTitle: null,
    bio: null,
    links: [],
    headshotUploaded: false,
    headshotUpdatedAt: null,
    headshotUrl: null,
  };
}

export async function saveProposalAccessChanges(
  db: DatabaseLike,
  input: { token: ParticipantAuthority; signingSecret: string; body: ProposalAccessInput },
): Promise<ProposalAccessPatchResponse> {
  const proposal = await getProposalByManageToken(db, input.token, input.signingSecret);
  const event = await getEventById(db, proposal.event_id);
  const proposalType =
    input.body.proposalType === undefined
      ? undefined
      : requireConfiguredSessionType(event.settings_json, input.body.proposalType);
  const resubmitting = input.body.status === "resubmitted";
  const keepsDraft = proposal.status === "needs-work" && !resubmitting && input.body.status !== "withdrawn";
  // A resubmission hands over drafted answers, so they are checked and recorded the way submitted ones are.
  const draft = resubmitting ? readProposalRevisionDraft(proposal) : null;
  const customAnswers =
    input.body.details ??
    (draft && draft.detailsJson !== proposal.details_json
      ? parseJsonSafe<Record<string, unknown>>(draft.detailsJson, {})
      : undefined);
  const validatedForm =
    customAnswers === undefined
      ? undefined
      : await validateCustomAnswersForSubmission(db, {
          event: toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
          purpose: "proposal_submission",
          customAnswers,
        });
  const details = validatedForm?.answers;
  // Recorded form answers feed the reviewer view, so a draft does not replace them.
  const formSubmission =
    validatedForm?.form && !keepsDraft
      ? await prepareReplaceContextFormSubmission(
          db,
          validatedForm.form,
          {
            submittedByUserId: proposal.proposer_user_id,
            contextType: "proposal",
            contextRef: proposal.id,
          },
          details ?? {},
          new Date().toISOString(),
        )
      : null;
  const saved = await updateProposalForVerifiedOwner(db, proposal, {
    action: input.body.status === "withdrawn" ? "withdraw" : "update",
    proposalType,
    title: input.body.title,
    abstract: input.body.abstract,
    committeeNotes: input.body.committeeNotes,
    detailsJson: details === undefined ? undefined : Object.keys(details).length > 0 ? stringifyJson(details) : null,
    formSubmissionStatements: formSubmission?.statements,
    formPlacementId: validatedForm?.form?.placement?.id ?? null,
    resubmit: resubmitting,
  });

  return { success: true, proposal: toAccessibleProposal(saved) };
}
