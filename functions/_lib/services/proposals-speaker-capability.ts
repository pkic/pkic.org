import type { ParticipantAuthority } from "./participant-authority";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { verifyDatabaseCapability } from "./capability-links";
import type { ProposalRecord, ProposalSpeakerRecord } from "./proposals";
import {
  proposalSpeakerHeadshotColumns,
  proposalSpeakerProfileColumns,
  type ProposalSpeakerUserProfile,
} from "./proposal-speakers";
import { effectiveProposalSpeakerInviteExpirySql, inactiveEffectiveInviteExpirySql } from "../invite-validity";
import { ownedIdentityLifecycleSql } from "./identities/selection";
import { nowIso, persistedUtcInstant } from "../utils/time";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { identityJobTitleSql } from "./identities/affiliation-projection";
import { proposalSpeakerIdentityIdSql } from "./proposal-speaker-profile-projection";
import { proposalActingIdentityReadModel } from "./proposal-speaker-identity";
import { unclaimedAccountSql } from "./proposal-speaker-account-authority";
import {
  speakerCurrentRepresentationSchema,
  speakerSelfServiceProfileSchema,
  type SpeakerCurrentRepresentation,
} from "../../../assets/shared/schemas/speaker-self-service";

export interface SpeakerWithContext {
  speaker: ProposalSpeakerRecord;
  proposal: ProposalRecord;
  currentRepresentation: SpeakerCurrentRepresentation | null;
  user: ProposalSpeakerUserProfile & {
    id: string;
    /** The account has proved a mailbox, so a speaker link alone no longer changes its name or headshot. */
    account_claimed: boolean;
  };
}

export async function getSpeakerByManageToken(
  db: DatabaseLike,
  manageToken: ParticipantAuthority,
  signingSecret: string,
): Promise<SpeakerWithContext> {
  if (typeof manageToken !== "string") {
    return getSpeakerByProposalUser(db, manageToken.resourceId, manageToken.userId);
  }
  const verified = await verifyDatabaseCapability({ db, signingSecret, purpose: "speaker_manage", token: manageToken });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "SPEAKER_TOKEN_EXPIRED" : "SPEAKER_TOKEN_NOT_FOUND",
      verified.reason === "expired" ? "Speaker manage link has expired" : "Invalid speaker token",
    );
  }

  return getSpeakerById(db, verified.resourceId);
}

/** Reads one speaker's context; the caller supplies either self authority or organizer permission. */
export async function getSpeakerByProposalUser(
  db: DatabaseLike,
  proposalId: string,
  userId: string,
): Promise<SpeakerWithContext> {
  const row = await first<{ id: string }>(
    db,
    "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
    [proposalId, userId],
  );
  if (!row) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker participation not found");
  return getSpeakerById(db, row.id, userId);
}

async function getSpeakerById(db: DatabaseLike, speakerId: string, userId?: string): Promise<SpeakerWithContext> {
  const row = await first<{
    ps_id: string;
    ps_proposal_id: string;
    ps_user_id: string;
    ps_role: ProposalSpeakerRecord["role"];
    ps_status: ProposalSpeakerRecord["status"];
    ps_manage_link_secret: string | null;
    ps_terms_accepted_at: string | null;
    ps_confirmed_at: string | null;
    ps_declined_at: string | null;
    ps_decline_reason: string | null;
    ps_created_at: string;
    ps_invite_generation: number;
    ps_invite_expires_at: string | null;
    ps_invited_email: string | null;
    ps_invite_expired: number;
    sp_id: string;
    sp_event_id: string;
    sp_proposer_user_id: string;
    sp_status: ProposalRecord["status"];
    sp_proposal_type: ProposalRecord["proposal_type"];
    sp_title: string;
    sp_abstract: string;
    sp_details_json: string | null;
    sp_form_placement_id: string | null;
    sp_referral_code: string | null;
    sp_manage_link_secret: string;
    sp_review_round: number;
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
    u_account_claimed: number;
    ps_acting_identity_id: string | null;
    ps_acting_identity_selected_at: string | null;
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
       ps.invite_expires_at AS ps_invite_expires_at,
       ps.invited_email   AS ps_invited_email,
       CASE
         WHEN ps.status IN ('invited', 'pending')
           AND (${inactiveEffectiveInviteExpirySql(
             effectiveProposalSpeakerInviteExpirySql("ps", "e"),
             "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
           )})
         THEN 1 ELSE 0
       END AS ps_invite_expired,
       sp.id              AS sp_id,
       sp.event_id        AS sp_event_id,
       sp.proposer_user_id AS sp_proposer_user_id,
       sp.status          AS sp_status,
       sp.proposal_type   AS sp_proposal_type,
       sp.title           AS sp_title,
       sp.abstract        AS sp_abstract,
       sp.details_json    AS sp_details_json,
       sp.form_placement_id AS sp_form_placement_id,
       sp.referral_code   AS sp_referral_code,
       sp.manage_link_secret AS sp_manage_link_secret,
       sp.review_round    AS sp_review_round,
       sp.submitted_at    AS sp_submitted_at,
       sp.updated_at      AS sp_updated_at,
       sp.withdrawn_at    AS sp_withdrawn_at,
       sp.presentation_deadline      AS sp_presentation_deadline,
       u.id               AS u_id,
       u.email            AS u_email,
       ${proposalSpeakerProfileColumns("u", "ps", "u_")},
       ${proposalSpeakerHeadshotColumns("u", "u_")},
       CASE WHEN ${unclaimedAccountSql("u")} THEN 0 ELSE 1 END AS u_account_claimed,
       ps.acting_identity_id AS ps_acting_identity_id
       , ps.acting_identity_selected_at AS ps_acting_identity_selected_at
     FROM proposal_speakers ps
     JOIN session_proposals sp ON sp.id = ps.proposal_id AND sp.deleted_at IS NULL
     JOIN events e                ON e.id  = sp.event_id
     JOIN users u              ON u.id  = ps.user_id
     WHERE ps.id = ?`,
    [speakerId],
  );

  if (!row || (userId !== undefined && row.ps_user_id !== userId)) {
    throw new AppError(404, "SPEAKER_TOKEN_NOT_FOUND", "Invalid or expired speaker token");
  }
  if (row.ps_invite_expired === 1) {
    throw new AppError(410, "SPEAKER_INVITATION_EXPIRED", "Speaker invitation has expired");
  }

  const context: SpeakerWithContext = {
    currentRepresentation: null,
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
      invite_expires_at: row.ps_invite_expires_at,
      invited_email: row.ps_invited_email,
      acting_identity_id: row.ps_acting_identity_id,
      acting_identity_selected_at: row.ps_acting_identity_selected_at,
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
      form_placement_id: row.sp_form_placement_id,
      referral_code: row.sp_referral_code,
      manage_link_secret: row.sp_manage_link_secret,
      review_round: row.sp_review_round,
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
      account_claimed: row.u_account_claimed === 1,
    },
  };
  context.currentRepresentation = await currentSpeakerRepresentation(db, context.speaker);
  return context;
}

/**
 * The identity the speaker speaks as, read from the identity itself once they
 * have chosen: the organization identity they chose, or their individual
 * identity when they take part as an individual. Null until they choose, or
 * when that identity is no longer theirs or its address is unverified.
 */
async function currentSpeakerRepresentation(
  db: DatabaseLike,
  speaker: ProposalSpeakerRecord,
): Promise<SpeakerCurrentRepresentation | null> {
  if (!speaker.acting_identity_selected_at) return null;
  const at = nowIso();
  const identity = await first<{
    id: string;
    email_id: string | null;
    email: string;
    organization_id: string | null;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
    updated_at: string;
  }>(
    db,
    `SELECT identity.id, identity.email_id,
      CASE WHEN identity.email_id IS NULL THEN user.normalized_email ELSE selected_email.normalized_email END AS email,
      identity.organization_id, organization.name AS organization_name,
      ${identityJobTitleSql("identity.id")} AS job_title, identity.biography, identity.links_json, identity.updated_at
    FROM proposal_speakers ps
    JOIN identities identity ON identity.id=(${proposalSpeakerIdentityIdSql("ps")}) AND identity.user_id=ps.user_id
    JOIN users user ON user.id=identity.user_id AND user.active=1
    LEFT JOIN organizations organization ON organization.id=identity.organization_id
    LEFT JOIN user_emails selected_email ON selected_email.id=identity.email_id
      AND selected_email.user_id=identity.user_id AND selected_email.verified_at IS NOT NULL
    WHERE ps.id=? AND ${ownedIdentityLifecycleSql("identity", "?")}
      AND ((identity.email_id IS NULL AND user.email_verified_at IS NOT NULL) OR selected_email.id IS NOT NULL)`,
    [speaker.id, at, at, at],
  );
  if (!identity) return null;
  const individual = speaker.acting_identity_id === null;
  if (individual !== (identity.organization_id === null)) return null;
  return speakerCurrentRepresentationSchema.parse({
    ...proposalActingIdentityReadModel(speaker),
    identityId: identity.id,
    emailId: individual ? null : identity.email_id,
    email: identity.email,
    organizationId: identity.organization_id,
    organizationName: identity.organization_name,
    jobTitle: identity.job_title,
    biography: identity.biography,
    links: parseLinksJson(identity.links_json),
    updatedAt: persistedUtcInstant(identity.updated_at),
  });
}

/** How the speaker appears: the person's name and photo, and the profile of the identity they speak as. */
export function speakerSelfServiceProfileReadModel(
  context: SpeakerWithContext,
  headshotUrl: string | null,
  personalDetailsEditable: boolean,
) {
  const { speaker, user } = context;
  return speakerSelfServiceProfileSchema.parse({
    personalDetailsEditable,
    ...proposalActingIdentityReadModel(speaker),
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    organizationName: user.organization_name,
    jobTitle: user.job_title,
    biography: user.biography,
    links: parseLinksJson(user.links_json),
    headshotUploaded: Boolean(user.headshot_r2_key),
    headshotUpdatedAt: user.headshot_updated_at,
    headshotUrl,
  });
}
