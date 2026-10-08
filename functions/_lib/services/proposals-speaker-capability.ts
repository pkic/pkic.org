import type { ParticipantAuthority } from "./participant-authority";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { verifyDatabaseCapability } from "./capability-links";
import type { ProposalRecord, ProposalSpeakerRecord } from "./proposals";
import {
  proposalSpeakerEffectiveHeadshotColumns,
  proposalSpeakerEffectiveProfileColumns,
  type ProposalSpeakerUserProfile,
} from "./proposal-speakers";
import { effectiveProposalSpeakerInviteExpirySql, inactiveEffectiveInviteExpirySql } from "../invite-validity";
import { ownedIdentityLifecycleSql } from "./identities/selection";
import { nowIso, persistedUtcInstant } from "../utils/time";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { proposalActingIdentitySnapshotSchema } from "../../../assets/shared/schemas/proposal-acting-identity";
import { proposalActingIdentityReadModel } from "./proposal-speaker-identity";
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
    proposalProfileOverridesJson: string;
    proposalHeadshotOverrideSet: number;
    proposalHeadshotOverrideKey: string | null;
    proposalHeadshotOverrideUpdatedAt: string | null;
    accountHeadshotR2Key: string | null;
    accountHeadshotUpdatedAt: string | null;
  };
}

export async function getSpeakerByManageToken(
  db: DatabaseLike,
  manageToken: ParticipantAuthority,
  signingSecret: string,
): Promise<SpeakerWithContext> {
  if (typeof manageToken !== "string") {
    const owned = await first<{ id: string }>(
      db,
      "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      [manageToken.resourceId, manageToken.userId],
    );
    if (!owned) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker participation not found");
    return getSpeakerById(db, owned.id, manageToken.userId);
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
    u_base_headshot_r2_key: string | null;
    u_base_headshot_updated_at: string | null;
    ps_headshot_override_set: number;
    ps_headshot_override_r2_key: string | null;
    ps_headshot_override_updated_at: string | null;
    ps_profile_overrides_json: string;
    ps_acting_identity_id: string | null;
    ps_acting_identity_selected_at: string | null;
    ps_acting_identity_snapshot_json: string | null;
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
       ${proposalSpeakerEffectiveProfileColumns("u", "ps", "u_")},
       ${proposalSpeakerEffectiveHeadshotColumns("u", "ps", "u_")},
       u.headshot_r2_key AS u_base_headshot_r2_key,
       u.headshot_updated_at AS u_base_headshot_updated_at,
       ps.headshot_override_set AS ps_headshot_override_set,
       ps.headshot_r2_key AS ps_headshot_override_r2_key,
       ps.headshot_updated_at AS ps_headshot_override_updated_at,
       ps.profile_overrides_json AS ps_profile_overrides_json
       , ps.acting_identity_id AS ps_acting_identity_id
       , ps.acting_identity_selected_at AS ps_acting_identity_selected_at
       , ps.acting_identity_snapshot_json AS ps_acting_identity_snapshot_json
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
      acting_identity_id: row.ps_acting_identity_id,
      acting_identity_selected_at: row.ps_acting_identity_selected_at,
      acting_identity_snapshot_json: row.ps_acting_identity_snapshot_json,
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
      proposalProfileOverridesJson: row.ps_profile_overrides_json,
      email: row.u_email,
      first_name: row.u_first_name,
      last_name: row.u_last_name,
      organization_name: row.u_organization_name,
      job_title: row.u_job_title,
      biography: row.u_biography,
      links_json: row.u_links_json,
      headshot_r2_key: row.u_headshot_r2_key,
      headshot_updated_at: row.u_headshot_updated_at,
      accountHeadshotR2Key: row.u_base_headshot_r2_key,
      accountHeadshotUpdatedAt: row.u_base_headshot_updated_at,
      proposalHeadshotOverrideSet: row.ps_headshot_override_set,
      proposalHeadshotOverrideKey: row.ps_headshot_override_r2_key,
      proposalHeadshotOverrideUpdatedAt: row.ps_headshot_override_updated_at,
    },
  };
  context.currentRepresentation = await currentSpeakerRepresentation(db, context.speaker);
  return context;
}

async function currentSpeakerRepresentation(
  db: DatabaseLike,
  speaker: ProposalSpeakerRecord,
): Promise<SpeakerCurrentRepresentation | null> {
  if (!speaker.acting_identity_selected_at || !speaker.acting_identity_snapshot_json) return null;
  let recorded: ReturnType<typeof proposalActingIdentitySnapshotSchema.safeParse>;
  try {
    recorded = proposalActingIdentitySnapshotSchema.safeParse(JSON.parse(speaker.acting_identity_snapshot_json));
  } catch {
    return null;
  }
  if (!recorded.success) return null;
  const selection = proposalActingIdentityReadModel(speaker);
  if (speaker.acting_identity_id === null) {
    if (recorded.data.organizationName !== null || recorded.data.jobTitle !== null) return null;
    const user = await first<{
      email: string;
      biography: string | null;
      links_json: string | null;
      updated_at: string;
    }>(
      db,
      `SELECT normalized_email AS email, biography, links_json, updated_at
       FROM users WHERE id=? AND active=1 AND email_verified_at IS NOT NULL`,
      [speaker.user_id],
    );
    return user
      ? speakerCurrentRepresentationSchema.parse({
          ...selection,
          emailId: null,
          email: user.email,
          organizationId: null,
          organizationName: null,
          jobTitle: null,
          biography: user.biography,
          links: parseLinksJson(user.links_json),
          updatedAt: persistedUtcInstant(user.updated_at),
        })
      : null;
  }
  const at = nowIso();
  const identity = await first<{
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
    `SELECT identity.email_id,
      CASE WHEN identity.email_id IS NULL THEN user.normalized_email ELSE selected_email.normalized_email END AS email,
      identity.organization_id, organization.name AS organization_name,
      identity.job_title, identity.biography, identity.links_json, identity.updated_at
    FROM identities identity
    JOIN users user ON user.id=identity.user_id AND user.active=1
    LEFT JOIN organizations organization ON organization.id=identity.organization_id
    LEFT JOIN user_emails selected_email ON selected_email.id=identity.email_id
      AND selected_email.user_id=identity.user_id AND selected_email.verified_at IS NOT NULL
    WHERE identity.id=? AND identity.user_id=? AND ${ownedIdentityLifecycleSql("identity", "?")}
      AND ((identity.email_id IS NULL AND user.email_verified_at IS NOT NULL) OR selected_email.id IS NOT NULL)`,
    [speaker.acting_identity_id, speaker.user_id, at, at, at],
  );
  return identity
    ? speakerCurrentRepresentationSchema.parse({
        ...selection,
        emailId: identity.email_id,
        email: identity.email,
        organizationId: identity.organization_id,
        organizationName: identity.organization_name,
        jobTitle: identity.job_title,
        biography: identity.biography,
        links: parseLinksJson(identity.links_json),
        updatedAt: persistedUtcInstant(identity.updated_at),
      })
    : null;
}

/** Recorded appearance remains scoped to this roster row; live edits use the separate representation. */
export function speakerSelfServiceProfileReadModel(context: SpeakerWithContext, headshotUrl: string | null) {
  const { speaker, user } = context;
  return speakerSelfServiceProfileSchema.parse({
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
