import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { verifyDatabaseCapability } from "./capability-links";
import type { ProposalRecord, ProposalSpeakerRecord } from "./proposals";

export interface SpeakerWithContext {
  speaker: ProposalSpeakerRecord;
  proposal: ProposalRecord;
  user: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
    headshot_r2_key: string | null;
    headshot_updated_at: string | null;
  };
}

export async function getSpeakerByManageToken(
  db: DatabaseLike,
  manageToken: string,
  signingSecret: string,
): Promise<SpeakerWithContext> {
  const verified = await verifyDatabaseCapability({ db, signingSecret, purpose: "speaker_manage", token: manageToken });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "SPEAKER_TOKEN_EXPIRED" : "SPEAKER_TOKEN_NOT_FOUND",
      verified.reason === "expired" ? "Speaker manage link has expired" : "Invalid speaker token",
    );
  }

  const row = await first<{
    ps_id: string;
    ps_proposal_id: string;
    ps_user_id: string;
    ps_role: string;
    ps_status: string;
    ps_manage_link_secret: string | null;
    ps_terms_accepted_at: string | null;
    ps_confirmed_at: string | null;
    ps_declined_at: string | null;
    ps_decline_reason: string | null;
    ps_created_at: string;
    ps_invite_generation: number;
    sp_id: string;
    sp_event_id: string;
    sp_proposer_user_id: string;
    sp_status: string;
    sp_proposal_type: string;
    sp_title: string;
    sp_abstract: string;
    sp_details_json: string | null;
    sp_referral_code: string | null;
    sp_manage_link_secret: string;
    sp_submitted_at: string;
    sp_updated_at: string;
    sp_withdrawn_at: string | null;
    sp_presentation_deadline: string | null;
    u_id: string;
    u_email: string;
    u_first_name: string | null;
    u_last_name: string | null;
    u_organization_name: string | null;
    u_job_title: string | null;
    u_biography: string | null;
    u_links_json: string | null;
    u_headshot_r2_key: string | null;
    u_headshot_updated_at: string | null;
  }>(
    db,
    `SELECT
       ps.id              AS ps_id,
       ps.proposal_id     AS ps_proposal_id,
       ps.user_id         AS ps_user_id,
       ps.role            AS ps_role,
       ps.status          AS ps_status,
       ps.manage_link_secret AS ps_manage_link_secret,
       ps.terms_accepted_at AS ps_terms_accepted_at,
       ps.confirmed_at    AS ps_confirmed_at,
       ps.declined_at     AS ps_declined_at,
       ps.decline_reason  AS ps_decline_reason,
       ps.created_at      AS ps_created_at,
       ps.invite_generation AS ps_invite_generation,
       sp.id              AS sp_id,
       sp.event_id        AS sp_event_id,
       sp.proposer_user_id AS sp_proposer_user_id,
       sp.status          AS sp_status,
       sp.proposal_type   AS sp_proposal_type,
       sp.title           AS sp_title,
       sp.abstract        AS sp_abstract,
       sp.details_json    AS sp_details_json,
       sp.referral_code   AS sp_referral_code,
       sp.manage_link_secret AS sp_manage_link_secret,
       sp.submitted_at    AS sp_submitted_at,
       sp.updated_at      AS sp_updated_at,
       sp.withdrawn_at    AS sp_withdrawn_at,
       sp.presentation_deadline      AS sp_presentation_deadline,
       u.id               AS u_id,
       u.email            AS u_email,
       u.first_name       AS u_first_name,
       u.last_name        AS u_last_name,
       u.organization_name AS u_organization_name,
       u.job_title        AS u_job_title,
       u.biography        AS u_biography,
       u.links_json       AS u_links_json,
       u.headshot_r2_key  AS u_headshot_r2_key,
       u.headshot_updated_at AS u_headshot_updated_at
     FROM proposal_speakers ps
     JOIN session_proposals sp ON sp.id = ps.proposal_id AND sp.deleted_at IS NULL
     JOIN users u              ON u.id  = ps.user_id
     WHERE ps.id = ?`,
    [verified.resourceId],
  );

  if (!row) {
    throw new AppError(404, "SPEAKER_TOKEN_NOT_FOUND", "Invalid or expired speaker token");
  }

  return {
    speaker: {
      id: row.ps_id,
      proposal_id: row.ps_proposal_id,
      user_id: row.ps_user_id,
      role: row.ps_role,
      status: row.ps_status,
      manage_link_secret: row.ps_manage_link_secret,
      terms_accepted_at: row.ps_terms_accepted_at,
      confirmed_at: row.ps_confirmed_at,
      declined_at: row.ps_declined_at,
      decline_reason: row.ps_decline_reason,
      created_at: row.ps_created_at,
      invite_generation: row.ps_invite_generation,
    },
    proposal: {
      id: row.sp_id,
      event_id: row.sp_event_id,
      proposer_user_id: row.sp_proposer_user_id,
      status: row.sp_status,
      proposal_type: row.sp_proposal_type,
      title: row.sp_title,
      abstract: row.sp_abstract,
      details_json: row.sp_details_json,
      referral_code: row.sp_referral_code,
      manage_link_secret: row.sp_manage_link_secret,
      submitted_at: row.sp_submitted_at,
      updated_at: row.sp_updated_at,
      withdrawn_at: row.sp_withdrawn_at,
      presentation_deadline: row.sp_presentation_deadline,
    },
    user: {
      id: row.u_id,
      email: row.u_email,
      first_name: row.u_first_name,
      last_name: row.u_last_name,
      organization_name: row.u_organization_name,
      job_title: row.u_job_title,
      biography: row.u_biography,
      links_json: row.u_links_json,
      headshot_r2_key: row.u_headshot_r2_key,
      headshot_updated_at: row.u_headshot_updated_at,
    },
  };
}
