import { first } from "../db/queries";
import type { DatabaseLike } from "../types";
import { resolveEventSessionTypes } from "./events";
import { resolveEventFormResponse } from "./forms";

interface ProposalDetailRow {
  id: string;
  event_id: string;
  proposer_user_id: string;
  status: string;
  proposal_type: string;
  title: string;
  abstract: string;
  review_round: number;
  details_json: string | null;
  submitted_at: string;
  updated_at: string;
  canceled_at: string | null;
  cancellation_comment: string | null;
  form_placement_id: string | null;
  proposer_email: string;
  proposer_first_name: string | null;
  proposer_last_name: string | null;
  review_count: number;
  decision_status: string | null;
  decision_note: string | null;
  decision_decided_at: string | null;
  event_settings_json: string;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_timezone: string;
  event_source_mode: string | null;
}

export async function getProposalDetailData(db: DatabaseLike, proposalId: string) {
  const proposal = await first<ProposalDetailRow>(
    db,
    `SELECT
       sp.id, sp.event_id, sp.proposer_user_id, sp.status, sp.proposal_type,
       sp.title, sp.abstract, sp.details_json, sp.form_placement_id, sp.review_round, sp.submitted_at, sp.updated_at,
       sp.canceled_at, sp.cancellation_comment,
       u.email AS proposer_email, u.first_name AS proposer_first_name,
       u.last_name AS proposer_last_name, e.settings_json AS event_settings_json,
       e.starts_at AS event_starts_at, e.ends_at AS event_ends_at, e.timezone AS event_timezone,
       e.source_mode AS event_source_mode,
       (SELECT COUNT(*) FROM proposal_reviews pr
        WHERE pr.proposal_id = sp.id AND pr.review_round = sp.review_round) AS review_count,
       pd.final_status AS decision_status, pd.decision_note,
       pd.decided_at AS decision_decided_at
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     JOIN events e ON e.id = sp.event_id
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE sp.id = ?`,
    [proposalId],
  );
  if (!proposal) return null;

  const formResponse = await resolveEventFormResponse(db, {
    source: "proposal",
    sourceId: proposal.id,
    event: { id: proposal.event_id, source_mode: proposal.event_source_mode },
    formPlacementId: proposal.form_placement_id,
    answersJson: proposal.details_json,
  });
  return {
    eventId: proposal.event_id,
    event: {
      startsAt: proposal.event_starts_at,
      endsAt: proposal.event_ends_at,
      timezone: proposal.event_timezone,
    },
    proposal: {
      id: proposal.id,
      event_id: proposal.event_id,
      proposer_user_id: proposal.proposer_user_id,
      status: proposal.status,
      proposal_type: proposal.proposal_type,
      title: proposal.title,
      abstract: proposal.abstract,
      review_round: proposal.review_round,
      submitted_at: proposal.submitted_at,
      updated_at: proposal.updated_at,
      canceled_at: proposal.canceled_at,
      cancellation_comment: proposal.cancellation_comment,
      proposer_email: proposal.proposer_email,
      proposer_first_name: proposal.proposer_first_name,
      proposer_last_name: proposal.proposer_last_name,
      review_count: proposal.review_count,
      decision_status: proposal.decision_status,
      decision_note: proposal.decision_note,
      decision_decided_at: proposal.decision_decided_at,
      details: formResponse?.answers ?? null,
    },
    form:
      formResponse?.form == null
        ? null
        : {
            id: formResponse.form.id,
            title: formResponse.form.title,
            description: formResponse.form.description,
            fields: formResponse.form.fields,
          },
    sessionTypes: resolveEventSessionTypes(proposal.event_settings_json),
  };
}
