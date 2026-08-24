import type { z } from "zod";
import type {
  proposalManageReadResponseSchema,
  proposalManageSchema,
  proposalManageUpdateResponseSchema,
} from "../../../assets/shared/schemas/proposal-management";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import type { DatabaseLike } from "../types";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import { prepareReplaceContextFormSubmission, validateCustomAnswersForSubmission } from "./forms";
import { listProposalSpeakersWithStatus } from "./proposal-speakers";
import { getProposalByManageToken, type ProposalRecord, updateProposalForVerifiedOwner } from "./proposals";
import { getEventById, requireConfiguredSessionType } from "./events";

type ProposalManageInput = z.infer<typeof proposalManageSchema>;
type ProposalManageReadResponse = z.infer<typeof proposalManageReadResponseSchema>;
type ProposalManageUpdateResponse = z.infer<typeof proposalManageUpdateResponseSchema>;

function toManagedProposal(proposal: ProposalRecord): ProposalManageUpdateResponse["proposal"] {
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

export async function loadProposalManageView(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; appBaseUrl: string },
): Promise<ProposalManageReadResponse> {
  const proposal = await getProposalByManageToken(db, input.token, input.signingSecret);
  const speakers = await listProposalSpeakersWithStatus(db, proposal.id);

  return {
    success: true,
    proposal: toManagedProposal(proposal),
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
        ? `${input.appBaseUrl}/api/v1/proposals/manage/${encodeURIComponent(input.token)}/speakers/${encodeURIComponent(speaker.user_id)}/headshot?v=${encodeURIComponent(speaker.headshot_updated_at ?? "")}`
        : null,
    })),
  };
}

export async function saveProposalManageChanges(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; body: ProposalManageInput },
): Promise<ProposalManageUpdateResponse> {
  const proposal = await getProposalByManageToken(db, input.token, input.signingSecret);
  const proposalType =
    input.body.proposalType === undefined
      ? undefined
      : requireConfiguredSessionType(
          (await getEventById(db, proposal.event_id)).settings_json,
          input.body.proposalType,
        );
  const validatedForm =
    input.body.details === undefined
      ? undefined
      : await validateCustomAnswersForSubmission(db, {
          eventId: proposal.event_id,
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
    action: input.body.action,
    proposalType,
    title: input.body.title,
    abstract: input.body.abstract,
    detailsJson: details === undefined ? undefined : Object.keys(details).length > 0 ? stringifyJson(details) : null,
    formSubmissionStatements: formSubmission?.statements,
    formPlacementId: validatedForm?.form?.placement?.id ?? null,
  });

  return { success: true, proposal: toManagedProposal(saved) };
}
