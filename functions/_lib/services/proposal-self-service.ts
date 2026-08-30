import type { z } from "zod";
import type {
  proposalAccessPatchResponseSchema,
  proposalAccessPatchSchema,
  proposalAccessReadResponseSchema,
} from "../../../assets/shared/schemas/proposal-management";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import type { DatabaseLike } from "../types";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import {
  prepareReplaceContextFormSubmission,
  toEventFormResolutionEvent,
  validateCustomAnswersForSubmission,
} from "./forms";
import { listProposalSpeakersWithStatus } from "./proposal-speakers";
import { getProposalByManageToken, type ProposalRecord, updateProposalForVerifiedOwner } from "./proposals";
import { getEventById, requireConfiguredSessionType } from "./events";
import { proposalAccessPath } from "../../../assets/shared/proposal-access-paths";

type ProposalAccessInput = z.infer<typeof proposalAccessPatchSchema>;
type ProposalAccessReadResponse = z.infer<typeof proposalAccessReadResponseSchema>;
type ProposalAccessPatchResponse = z.infer<typeof proposalAccessPatchResponseSchema>;

function toAccessibleProposal(proposal: ProposalRecord): ProposalAccessPatchResponse["proposal"] {
  return {
    id: proposal.id,
    proposer_user_id: proposal.proposer_user_id,
    status: proposal.status,
    proposal_type: proposal.proposal_type,
    title: proposal.title,
    abstract: proposal.abstract,
    details: parseJsonSafe<Record<string, unknown> | null>(proposal.details_json, null),
  };
}

export async function loadProposalAccessView(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; appBaseUrl: string },
): Promise<ProposalAccessReadResponse> {
  const proposal = await getProposalByManageToken(db, input.token, input.signingSecret);
  const speakers = await listProposalSpeakersWithStatus(db, proposal.id);

  return {
    success: true,
    proposal: toAccessibleProposal(proposal),
    speakers: speakers.map((speaker) => ({
      userId: speaker.user_id,
      role: speaker.role,
      status: speaker.status,
      confirmedAt: speaker.confirmed_at,
      declinedAt: speaker.declined_at,
      email: speaker.email,
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
    })),
  };
}

export async function saveProposalAccessChanges(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; body: ProposalAccessInput },
): Promise<ProposalAccessPatchResponse> {
  const proposal = await getProposalByManageToken(db, input.token, input.signingSecret);
  const event = await getEventById(db, proposal.event_id);
  const proposalType =
    input.body.proposalType === undefined
      ? undefined
      : requireConfiguredSessionType(event.settings_json, input.body.proposalType);
  const validatedForm =
    input.body.details === undefined
      ? undefined
      : await validateCustomAnswersForSubmission(db, {
          event: toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
          purpose: "proposal_submission",
          customAnswers: input.body.details,
        });
  const details = validatedForm?.answers;
  const formSubmission = validatedForm?.form
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
    detailsJson: details === undefined ? undefined : Object.keys(details).length > 0 ? stringifyJson(details) : null,
    formSubmissionStatements: formSubmission?.statements,
    formPlacementId: validatedForm?.form?.placement?.id ?? null,
  });

  return { success: true, proposal: toAccessibleProposal(saved) };
}
