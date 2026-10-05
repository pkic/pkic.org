import type { ParticipantAuthority } from "./participant-authority";
import type { z } from "zod";
import type { speakerSelfProfilePatchSchema } from "../../../assets/shared/schemas/proposal-management";
import { all, first } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import {
  isConsentAcceptanceContextConflict,
  prepareActiveTermsSnapshotGuard,
  prepareConsentStatements,
  validateRequiredConsents,
} from "./consent";
import { getRequiredTerms } from "./events";
import { getSpeakerByManageToken } from "./proposals";
import {
  proposalParticipantStatus,
  prepareProposalRoleCapacityForSpeakerChange,
  prepareProposalRoleCapacityForSpeakerRemoval,
} from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import {
  getProposalSpeakerRosterRevision,
  isProposalSpeakerRosterConflict,
  prepareProposalSpeakerRosterRevisionGuard,
} from "./proposal-speaker-roster-revision";
import { prepareUserProfileStatement, type UserProfilePatch } from "./users";
import {
  parseProposalProfileOverrides,
  prepareProposalSpeakerProfileAuthorityGuard,
  type ProposalProfileField,
  type ProposalProfileOverrideSnapshot,
} from "./proposal-speaker-profile-overrides";
import { proposalSpeakerEffectiveProfileColumns } from "./proposal-speakers";
import type { DatabaseLike, StatementLike } from "../types";
import { prepareProposalActingIdentity, type PreparedProposalActingIdentity } from "./proposal-speaker-identity";
import {
  prepareEventProposalProofRedemption,
  isEventProposalProofReplay,
  eventProposalProofReplayError,
} from "./event-proposal-proof-redemption";
import { prepareVerifiedOrganizationAffiliation } from "./identities";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../db/authorization-guard";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { parseCapabilityToken } from "../auth/capability-token";
import { activeEffectiveInviteExpirySql, effectiveProposalSpeakerInviteExpirySql } from "../invite-validity";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { proposalActingIdentitySnapshotSchema } from "../../../assets/shared/schemas/proposal-acting-identity";
import { parseJsonSafe } from "../utils/json";
import { ownedIdentityAtEvidence } from "./identities/selection";
import { utcInstantSchema } from "../../../assets/shared/schemas/api-common";

/** Rechecks the verified link/session and current invitation scope inside the profile/confirmation batch. */
export function prepareSpeakerSelfAuthorityGuard(
  db: DatabaseLike,
  authority: ParticipantAuthority,
  context: {
    proposalSpeakerId: string;
    proposalId: string;
    userId: string;
    inviteGeneration: number;
    expectedManageLinkSecret?: string | null;
  },
) {
  const capability = typeof authority === "string" ? parseCapabilityToken(authority, "speaker_manage") : null;
  if (typeof authority === "string" && (!capability || capability.resourceId !== context.proposalSpeakerId)) {
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "Invalid speaker authority.");
  }
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM proposal_speakers ps
          JOIN session_proposals sp ON sp.id=ps.proposal_id AND sp.deleted_at IS NULL
          JOIN events e ON e.id=sp.event_id
          WHERE ps.id=? AND ps.proposal_id=? AND ps.user_id=? AND ps.invite_generation=?
            AND (ps.status NOT IN ('invited','pending') OR (${activeEffectiveInviteExpirySql(
              effectiveProposalSpeakerInviteExpirySql("ps", "e"),
              "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            )}))
            AND ${
              capability
                ? "ps.manage_link_secret IS ? AND ? > unixepoch('now')"
                : "EXISTS (SELECT 1 FROM sessions WHERE id=? AND user_id=ps.user_id AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
            }`,
    bindings: [
      context.proposalSpeakerId,
      context.proposalId,
      context.userId,
      context.inviteGeneration,
      ...(capability
        ? [context.expectedManageLinkSecret ?? null, capability.expiresAt]
        : [typeof authority === "string" ? "" : (authority.sessionId ?? "")]),
    ],
  });
}

export async function getProposalCoSpeakers(
  db: DatabaseLike,
  proposalId: string,
  excludeUserId: string,
): Promise<{ firstName: string | null; lastName: string | null; status: string }[]> {
  return all<{ first_name: string | null; last_name: string | null; status: string }>(
    db,
    `SELECT ${proposalSpeakerEffectiveProfileColumns("u", "ps", "", ["firstName", "lastName"])}, ps.status
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.user_id != ?
     ORDER BY ps.created_at ASC`,
    [proposalId, excludeUserId],
  ).then((rows) => rows.map((r) => ({ firstName: r.first_name, lastName: r.last_name, status: r.status })));
}

export async function getPresentationUploader(
  db: DatabaseLike,
  proposalId: string,
): Promise<{ firstName: string | null; lastName: string | null; uploadedAt: string } | null> {
  const row = await first<{
    first_name: string | null;
    last_name: string | null;
    uploaded_at: string;
  }>(
    db,
    `SELECT u.first_name, u.last_name, pv.uploaded_at
     FROM presentation_versions pv
     LEFT JOIN users u ON u.id = pv.uploaded_by_user_id
     WHERE pv.proposal_id = ? AND pv.is_current = 1 AND pv.deleted_at IS NULL`,
    [proposalId],
  );
  if (!row) return null;
  return { firstName: row.first_name, lastName: row.last_name, uploadedAt: row.uploaded_at };
}

export async function confirmSpeakerParticipation(
  db: DatabaseLike,
  manageToken: ParticipantAuthority,
  signingSecret: string,
  payload: {
    consents: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken, signingSecret);

  if (speaker.status === "confirmed") return;
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker participation cannot be changed on a closed proposal");
  }
  if (speaker.status === "declined") {
    throw new AppError(
      409,
      "SPEAKER_ALREADY_DECLINED",
      "You have already declined participation. Please contact the organizer if you changed your mind.",
    );
  }
  const representationRequired = () =>
    new AppError(
      409,
      "SPEAKER_REPRESENTATION_REQUIRED",
      "Confirm your speaker identity before confirming participation.",
    );
  const snapshot = proposalActingIdentitySnapshotSchema.safeParse(
    parseJsonSafe<unknown>(speaker.acting_identity_snapshot_json, null),
  );
  if (
    !utcInstantSchema.safeParse(speaker.acting_identity_selected_at).success ||
    !snapshot.success ||
    (speaker.acting_identity_id === null &&
      (snapshot.data.organizationName !== null || snapshot.data.jobTitle !== null)) ||
    (speaker.acting_identity_id !== null && !snapshot.data.organizationName?.trim())
  )
    throw representationRequired();
  const now = nowIso();
  const representation = speaker.acting_identity_id
    ? ownedIdentityAtEvidence({ userId: speaker.user_id, identityId: speaker.acting_identity_id, at: now })
    : null;
  if (representation)
    representation.sql +=
      " AND identity.organization_id IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL";
  if (
    representation &&
    !(await first(db, `SELECT 1 WHERE EXISTS (${representation.sql})`, [...representation.bindings]))
  )
    throw representationRequired();
  const requiredTerms = await getRequiredTerms(db, proposal.event_id, "speaker");
  await validateRequiredConsents(requiredTerms, payload.consents);
  const rosterRevision = await getProposalSpeakerRosterRevision(db, proposal.id);
  try {
    await db.batch([
      prepareSpeakerSelfAuthorityGuard(db, manageToken, {
        proposalSpeakerId: speaker.id,
        proposalId: proposal.id,
        userId: speaker.user_id,
        inviteGeneration: speaker.invite_generation,
        expectedManageLinkSecret: speaker.manage_link_secret,
      }),
      prepareProposalSpeakerRosterRevisionGuard(db, {
        proposalId: proposal.id,
        expectedRevision: rosterRevision,
      }),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM proposal_speakers WHERE id=? AND user_id=? AND acting_identity_selected_at IS NOT NULL AND acting_identity_snapshot_json IS NOT NULL AND acting_identity_id IS ? AND acting_identity_selected_at IS ? AND acting_identity_snapshot_json IS ?",
        bindings: [
          speaker.id,
          speaker.user_id,
          speaker.acting_identity_id,
          speaker.acting_identity_selected_at,
          speaker.acting_identity_snapshot_json,
        ],
      }),
      ...(representation ? [prepareAuthorizationGuard(db, representation)] : []),
      prepareActiveTermsSnapshotGuard(db, proposal.event_id, requiredTerms, "speaker"),
      ...(await prepareConsentStatements(db, {
        proposalId: proposal.id,
        eventId: proposal.event_id,
        userId: speaker.user_id,
        audienceType: "speaker",
        accepted: payload.consents,
        ip: payload.ip,
        userAgent: payload.userAgent,
        secret: signingSecret,
      })),
      db
        .prepare(
          `UPDATE proposal_speakers
           SET status = 'confirmed', confirmed_at = ?, terms_accepted_at = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ? AND invite_generation = ?
             AND acting_identity_id IS ? AND acting_identity_selected_at IS ? AND acting_identity_snapshot_json IS ?
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          now,
          now,
          speaker.id,
          proposal.id,
          speaker.user_id,
          speaker.role,
          speaker.status,
          speaker.invite_generation,
          speaker.acting_identity_id,
          speaker.acting_identity_selected_at,
          speaker.acting_identity_snapshot_json,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: speaker.proposal_id },
        "user",
        speaker.user_id,
        "speaker_confirmed",
        "proposal_speaker",
        speaker.id,
        { proposalId: speaker.proposal_id },
        now,
      ),
      ...(await prepareProposalRoleCapacityForSpeakerChange(db, {
        eventId: proposal.event_id,
        userId: speaker.user_id,
        proposalRole: speaker.role,
        sourceRef: proposal.id,
        status: proposalParticipantStatus(proposal.status, "confirmed"),
        sourceRevisionAdvance: 1,
      })),
    ]);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (
      isAuditChangeGuardFailure(error) ||
      isAuthorizationGuardFailure(error) ||
      isEventParticipantSourceConflict(error) ||
      isProposalSpeakerRosterConflict(error) ||
      isConsentAcceptanceContextConflict(error)
    ) {
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "Speaker participation changed while it was being confirmed",
      );
    }
    throw error;
  }
}

export async function declineSpeakerParticipation(
  db: DatabaseLike,
  manageToken: ParticipantAuthority,
  signingSecret: string,
  payload: { reason?: string | null },
): Promise<void> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken, signingSecret);

  if (speaker.status === "declined") {
    return;
  }
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker participation cannot be changed on a closed proposal");
  }

  const nonDeclined = await first<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM proposal_speakers WHERE proposal_id = ? AND status <> 'declined'",
    [proposal.id],
  );
  if (Number(nonDeclined?.total ?? 0) <= 1) {
    throw new AppError(
      409,
      "LAST_SPEAKER_REQUIRED",
      "A proposal must retain at least one speaker. Add another speaker or withdraw the proposal instead.",
    );
  }

  const now = nowIso();
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE proposal_speakers
           SET status = 'declined', declined_at = ?, decline_reason = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ? AND invite_generation = ?
             AND (SELECT COUNT(*) FROM proposal_speakers
                  WHERE proposal_id = ? AND status <> 'declined') > 1
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          now,
          payload.reason ?? null,
          speaker.id,
          proposal.id,
          speaker.user_id,
          speaker.role,
          speaker.status,
          speaker.invite_generation,
          proposal.id,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: speaker.proposal_id },
        "user",
        speaker.user_id,
        "speaker_declined",
        "proposal_speaker",
        speaker.id,
        { proposalId: speaker.proposal_id, reason: payload.reason ?? null },
        now,
      ),
      ...(await prepareProposalRoleCapacityForSpeakerRemoval(db, {
        eventId: proposal.event_id,
        userId: speaker.user_id,
        sourceRef: proposal.id,
      })),
    ]);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (!isAuditChangeGuardFailure(error) && !isEventParticipantSourceConflict(error)) throw error;

    const currentCount = await first<{ total: number }>(
      db,
      "SELECT COUNT(*) AS total FROM proposal_speakers WHERE proposal_id = ? AND status <> 'declined'",
      [proposal.id],
    );
    if (Number(currentCount?.total ?? 0) <= 1) {
      throw new AppError(
        409,
        "LAST_SPEAKER_REQUIRED",
        "A proposal must retain at least one speaker. Add another speaker or withdraw the proposal instead.",
      );
    }
    throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the decline was processed");
  }
}

export async function updateSpeakerProfile(
  db: DatabaseLike,
  payload: UserProfilePatch &
    Pick<
      z.infer<typeof speakerSelfProfilePatchSchema>,
      "actingIdentityId" | "continuationToken" | "unaffiliatedAttestation" | "consents"
    >,
  context: ProposalProfileOverrideSnapshot & {
    selectionAuthority?: { userId: string; sessionId: string };
    signingSecret?: string;
  },
): Promise<void> {
  const at = nowIso();
  const proofSelection = payload.continuationToken !== undefined;
  if (proofSelection && (!context.signingSecret || !context.authority)) {
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "Confirm your own speaker affiliation.");
  }
  const fields: ProposalProfileField[] = [];
  if (payload.firstName !== undefined) fields.push("firstName");
  if (payload.lastName !== undefined) fields.push("lastName");
  if (payload.organizationName !== undefined) fields.push("organizationName");
  if (payload.jobTitle !== undefined) fields.push("jobTitle");
  if (payload.biography !== undefined) fields.push("biography");
  if (payload.linksJson !== undefined) fields.push("links");
  if (fields.length === 0 && payload.actingIdentityId === undefined && !proofSelection) return;
  if (context.currentStatus === "declined")
    throw new AppError(403, "SPEAKER_DECLINED", "You have declined participation.");
  if (!isProposalSpeakerRosterEditableStatus(context.proposalStatus)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker profiles cannot be changed on a closed proposal");
  }
  const selectionAuthority =
    context.selectionAuthority ??
    (context.authority && typeof context.authority !== "string" ? context.authority : undefined);
  if (
    payload.actingIdentityId !== undefined &&
    !proofSelection &&
    (!selectionAuthority?.sessionId || selectionAuthority.userId !== context.userId)
  ) {
    throw new AppError(
      403,
      "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED",
      "Sign in to select your own speaker representation.",
    );
  }
  const proof = proofSelection
    ? await prepareEventProposalProofRedemption(db, {
        eventId:
          (
            await first<{ event_id: string }>(
              db,
              "SELECT event_id FROM session_proposals WHERE id=? AND deleted_at IS NULL",
              [context.proposalId],
            )
          )?.event_id ?? "",
        continuationToken: payload.continuationToken!,
        signingSecret: context.signingSecret!,
        operation: "speaker_profile",
        speakerId: context.proposalSpeakerId,
        speakerAuthority: context.authority!,
        actor: selectionAuthority?.sessionId
          ? { userId: selectionAuthority.userId, sessionId: selectionAuthority.sessionId }
          : undefined,
        at,
      })
    : null;
  if (proof && (proof.created || proof.user.id !== context.userId))
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "Confirm the mailbox for this speaker.");
  if (
    proof &&
    payload.unaffiliatedAttestation !== undefined &&
    payload.unaffiliatedAttestation !== (proof.applicantKind === "individual")
  )
    throw new AppError(422, "PROPOSAL_QUALIFICATION_CHANGED", "Confirm the selected affiliation again.");
  if (proof && payload.consents !== undefined) await validateRequiredConsents(proof.terms, payload.consents);
  if (proof?.applicantKind === "individual" && payload.actingIdentityId != null)
    throw new AppError(
      422,
      "PROPOSAL_QUALIFICATION_CHANGED",
      "An individual presentation cannot select an organization identity.",
    );
  if (proof?.applicantKind === "organization" && payload.actingIdentityId === null)
    throw new AppError(422, "PROPOSAL_QUALIFICATION_CHANGED", "Choose the confirmed organization affiliation.");
  let selected: PreparedProposalActingIdentity | null =
    payload.actingIdentityId === undefined
      ? null
      : await prepareProposalActingIdentity(db, {
          userId: context.userId,
          actingIdentityId: payload.actingIdentityId,
          at,
          profile: payload,
        });
  const affiliationStatements: StatementLike[] = [];
  if (proof && !selected) {
    if (proof.applicantKind === "individual") {
      selected = await prepareProposalActingIdentity(db, {
        userId: context.userId,
        actingIdentityId: null,
        at,
        profile: payload,
      });
    } else {
      const affiliation = await prepareVerifiedOrganizationAffiliation(db, {
        userId: context.userId,
        normalizedEmail: proof.normalizedEmail,
        emailId: proof.emailId,
        organizationName: payload.organizationName ?? undefined,
        at,
        proofEvidence: proof.proofEvidence,
        profile: payload,
      });
      affiliationStatements.push(...affiliation.statements);
      selected = { identityId: affiliation.identityId, selectedAt: at, snapshot: affiliation.snapshot, guards: [] };
    }
  }
  const knownPerson = selected
    ? await first<{ first_name: string | null; last_name: string | null }>(
        db,
        "SELECT first_name,last_name FROM users WHERE id=? AND active=1",
        [context.userId],
      )
    : null;
  const namePatch = {
    firstName: selected && knownPerson?.first_name ? undefined : payload.firstName,
    lastName: selected && knownPerson?.last_name ? undefined : payload.lastName,
  };
  if (selected && !knownPerson)
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "The speaker account is unavailable.");
  const overrides = parseProposalProfileOverrides(context.expectedProfileOverridesJson);
  // Name/headshot are account-owned. Affiliation, biography, and links are proposal-owned.
  for (const field of ["firstName", "lastName"] as const)
    if (selected || payload[field] !== undefined) delete overrides[field];
  if (selected) {
    delete overrides.organizationName;
    delete overrides.jobTitle;
    delete overrides.biography;
    delete overrides.links;
  } else {
    if (payload.organizationName !== undefined) overrides.organizationName = payload.organizationName;
    if (payload.jobTitle !== undefined) overrides.jobTitle = payload.jobTitle;
  }
  if (payload.biography !== undefined) overrides.biography = payload.biography;
  if (payload.linksJson !== undefined) overrides.links = parseLinksJson(payload.linksJson);
  const authorityGuard = context.authority ? prepareSpeakerSelfAuthorityGuard(db, context.authority, context) : null;
  const selectionSessionGuard =
    selected && !proof && selectionAuthority?.sessionId
      ? prepareAuthorizationGuard(db, {
          sql: "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
          bindings: [selectionAuthority.sessionId, context.userId],
        })
      : null;
  if (selected && !authorityGuard)
    throw new AppError(
      403,
      "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED",
      "Select your representation through your own speaker page.",
    );
  const statements = [
    ...(authorityGuard ? [authorityGuard] : []),
    ...(proof?.statements ?? []),
    ...affiliationStatements,
    ...(selectionSessionGuard ? [selectionSessionGuard] : []),
    ...(selected?.guards ?? []),
    ...(selected && (namePatch.firstName !== undefined || namePatch.lastName !== undefined)
      ? [
          prepareAuthorizationGuard(db, {
            sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND first_name IS ? AND last_name IS ?",
            bindings: [context.userId, knownPerson!.first_name, knownPerson!.last_name],
          }),
        ]
      : []),
    prepareProposalSpeakerProfileAuthorityGuard(db, context),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "proposal", id: context.proposalId },
      "user",
      context.userId,
      "speaker_profile_updated_by_speaker",
      "proposal_speaker",
      context.proposalSpeakerId,
      { fields, ...(selected ? { actingIdentityId: selected.identityId, selectedAt: selected.selectedAt } : {}) },
    ),
    ...(namePatch.firstName !== undefined || namePatch.lastName !== undefined
      ? [prepareUserProfileStatement(db, context.userId, namePatch)]
      : []),
    db
      .prepare(
        `UPDATE proposal_speakers SET profile_overrides_json=?, acting_identity_id=?,
      acting_identity_selected_at=?, acting_identity_snapshot_json=? WHERE id=? AND proposal_id=? AND user_id=?`,
      )
      .bind(
        JSON.stringify(overrides),
        selected ? selected.identityId : (context.expectedActingIdentityId ?? null),
        selected?.selectedAt ?? context.expectedActingIdentitySelectedAt ?? null,
        selected ? JSON.stringify(selected.snapshot) : (context.expectedActingIdentitySnapshotJson ?? null),
        context.proposalSpeakerId,
        context.proposalId,
        context.userId,
      ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isEventProposalProofReplay(error)) throw eventProposalProofReplayError();
    if (isAuditChangeGuardFailure(error) || isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "Speaker representation or profile changed while it was being updated",
      );
    }
    throw error;
  }
}

export const prepareSpeakerProfileStatement = prepareUserProfileStatement;
