/**
 * Staff sponsorship sales pipeline. Split out of sponsorship.ts.
 */
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { eventSponsorTierHasAttendeeAccess } from "./event-tiers";
import { getSponsorship, type SponsorshipReadModelRow } from "./read-model";
import { isAuditChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { escapeMarkdownText } from "../../email/markdown";
import { queueSponsorPortalSignInCapability } from "../../auth/sponsor-portal";
import { prepareRefreshOrganizationSponsorshipProjection, prepareSponsorshipStageTransition } from "./stage-transition";
import { hasFutureRenewalDate, initialRenewalActionDueAt, utcDate } from "./renewal-policy";
import {
  SPONSORSHIP_PIPELINE_STAGES,
  type SponsorshipPipelineStage,
} from "../../../../assets/shared/schemas/sponsorship-management";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";

export { SPONSORSHIP_PIPELINE_STAGES };
export type { SponsorshipPipelineStage };

export interface CreateSponsorshipInput {
  sponsorType: "consortium" | "event";
  organizationId: string | null;
  nonMemberName: string | null;
  nonMemberWebsite: string | null;
  contactName: string | null;
  contactEmail: string | null;
  eventId: string | null;
  tier: string | null;
  assignedToUserId: string | null;
  renewalDate: string | null;
  notes: string | null;
}

export async function createSponsorship(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: CreateSponsorshipInput,
): Promise<{ id: string }> {
  const id = uuid();
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `INSERT INTO sponsorships
           (id, sponsor_type, organization_id, non_member_name, non_member_website, contact_name, contact_email,
            event_id, tier, pipeline_stage, assigned_to_user_id, renewal_date, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new_inquiry', ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.sponsorType,
        input.organizationId,
        input.nonMemberName,
        input.nonMemberWebsite,
        input.contactName,
        input.contactEmail,
        input.eventId,
        input.tier,
        input.assignedToUserId,
        input.renewalDate,
        input.notes,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'new_inquiry', ?, 'Created by staff', ?)`,
      )
      .bind(uuid(), id, adminDatabaseUserId(actor), now),
    prepareAuditLog(
      db,
      "admin",
      actor.id,
      "sponsorship_created",
      "sponsorship",
      id,
      {
        sponsorType: input.sponsorType,
      },
      now,
    ),
  ]);

  return { id };
}

export interface UpdateSponsorshipInput {
  tier?: string | null;
  assignedToUserId?: string | null;
  renewalDate?: string | null;
  notes?: string | null;
}

function sponsorshipChangedError(): AppError {
  return new AppError(409, "SPONSORSHIP_CHANGED", "Sponsorship changed concurrently; reload it and try again");
}

export async function updateSponsorship(
  db: DatabaseLike,
  actorUserId: string,
  id: string,
  patch: UpdateSponsorshipInput,
): Promise<SponsorshipReadModelRow> {
  const existing = await getSponsorship(db, id);
  if (!existing) {
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }
  if (existing.pipeline_stage === "active" && patch.renewalDate === null) {
    throw new AppError(
      409,
      "ACTIVE_RENEWAL_DATE_REQUIRED",
      "An active sponsorship must retain a renewal date; lapse it before clearing the date",
    );
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.tier !== undefined) {
    fields.push("tier = ?");
    values.push(patch.tier);
  }
  if (patch.assignedToUserId !== undefined) {
    fields.push("assigned_to_user_id = ?");
    values.push(patch.assignedToUserId);
  }
  if (patch.renewalDate !== undefined) {
    fields.push("renewal_date = ?");
    values.push(patch.renewalDate);
  }
  if (patch.notes !== undefined) {
    fields.push("notes = ?");
    values.push(patch.notes);
  }

  if (
    existing.pipeline_stage === "active" &&
    (patch.renewalDate !== undefined || patch.assignedToUserId !== undefined)
  ) {
    fields.push("renewal_action_due_at = ?");
    values.push(
      initialRenewalActionDueAt({
        pipelineStage: existing.pipeline_stage,
        renewalDate: patch.renewalDate !== undefined ? patch.renewalDate : existing.renewal_date,
        assignedToUserId: patch.assignedToUserId !== undefined ? patch.assignedToUserId : existing.assigned_to_user_id,
      }),
    );
  }

  if (fields.length > 0) {
    const now = nowIso();
    fields.push("updated_at = ?", "transition_revision = transition_revision + 1");
    values.push(now);
    try {
      const statements: StatementLike[] = [
        db
          .prepare(`UPDATE sponsorships SET ${fields.join(", ")} WHERE id = ? AND transition_revision = ?`)
          .bind(...values, id, existing.transition_revision),
        prepareAuditLogAfterOneChange(db, "admin", actorUserId, "sponsorship_updated", "sponsorship", id, patch, now),
      ];
      if (
        patch.tier !== undefined &&
        existing.sponsor_type === "consortium" &&
        existing.organization_id &&
        existing.pipeline_stage === "active"
      ) {
        statements.push(prepareRefreshOrganizationSponsorshipProjection(db, existing.organization_id));
      }
      await db.batch(statements);
    } catch (error) {
      if (isAuditChangeGuardFailure(error)) throw sponsorshipChangedError();
      throw error;
    }
  }

  return (await getSponsorship(db, id)) as SponsorshipReadModelRow;
}

export interface AdvanceSponsorshipStageResult {
  sponsorship: SponsorshipReadModelRow;
  becameActive: boolean;
  becameLapsed: boolean;
  qualifiesForAttendeeDataAccess: boolean;
  outboxIds: string[];
}

/**
 * Advances (or otherwise changes) a sponsorship's pipeline stage, recording
 * the transition in sponsorship_events and applying the "On active"/"On
 * lapsed" side effects from:
 *  - consortium: writes/clears organizations.sponsor_tier + sponsor_start_date
 *  - event: no D1 side effect beyond the stage itself — attendee-data
 *    eligibility (event_sponsor_attendee_tiers) is checked live on every
 *    sponsor-portal request (see _lib/auth/sponsor-portal.ts), not cached
 *    as a grant row, because sponsor contacts have no `users` row for a
 *    permission_grants row to attach to. `qualifiesForAttendeeDataAccess`
 *    tells the caller (route) whether to send the sponsor-portal-access
 *    email on this transition.
 */
export async function advanceSponsorshipStage(
  db: DatabaseLike,
  params: {
    id: string;
    toStage: string;
    actor: AuthAdmin;
    note: string | null;
    notifications: { appBaseUrl: string; magicLinkTtlMinutes: number; signingSecret: string };
  },
): Promise<AdvanceSponsorshipStageResult> {
  if (!SPONSORSHIP_PIPELINE_STAGES.includes(params.toStage as SponsorshipPipelineStage)) {
    throw new AppError(400, "INVALID_STAGE", `Unknown pipeline stage: ${params.toStage}`);
  }

  const existing = await getSponsorship(db, params.id);
  if (!existing) {
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }

  const fromStage = existing.pipeline_stage;
  if (params.toStage === fromStage) {
    return {
      sponsorship: existing,
      becameActive: false,
      becameLapsed: false,
      qualifiesForAttendeeDataAccess: false,
      outboxIds: [],
    };
  }
  if (
    params.toStage === "active" &&
    fromStage !== "active" &&
    !hasFutureRenewalDate(existing.renewal_date, utcDate())
  ) {
    throw new AppError(
      409,
      "FUTURE_RENEWAL_DATE_REQUIRED",
      "Set a future renewal date before activating a sponsorship",
    );
  }
  const now = nowIso();
  const preparedTransition = prepareSponsorshipStageTransition(db, existing, {
    toStage: params.toStage,
    actor: params.actor,
    note: params.note,
    auditAction: "sponsorship_stage_advanced",
    now,
  });
  const { becameActive, becameLapsed } = preparedTransition;

  let qualifiesForAttendeeDataAccess = false;
  if (becameActive && existing.sponsor_type === "event" && existing.event_id && existing.tier) {
    qualifiesForAttendeeDataAccess = await eventSponsorTierHasAttendeeAccess(db, existing.event_id, existing.tier);
  }

  const statements: StatementLike[] = [...preparedTransition.statements];
  const outboxIds: string[] = [];

  if (becameActive && existing.sponsor_type === "consortium" && existing.contact_email) {
    const queued = prepareQueueEmailStatement(
      db,
      {
        templateKey: "sponsorship-active-confirmation",
        recipientEmail: existing.contact_email,
        messageType: "transactional",
        subject: "Your PKI Consortium sponsorship is now active",
        data: {
          contactNameText: escapeMarkdownText(existing.contact_name ?? existing.organization_name ?? "there"),
          organizationNameText: escapeMarkdownText(existing.organization_name ?? ""),
          tierText: escapeMarkdownText(existing.tier ?? ""),
          startDate: existing.start_date ?? now,
        },
      },
      now,
    );
    statements.push(queued.statement);
    outboxIds.push(queued.id);
  }

  if (becameActive && qualifiesForAttendeeDataAccess && existing.contact_email) {
    const magicLink = await queueSponsorPortalSignInCapability(params.id, existing.contact_email, {
      ttlMinutes: params.notifications.magicLinkTtlMinutes,
      signingSecret: params.notifications.signingSecret,
    });
    const portalUrl = `${params.notifications.appBaseUrl}/sponsor-portal/?token=${encodeURIComponent(magicLink.queuedToken)}`;
    const queued = prepareQueueEmailStatement(
      db,
      {
        templateKey: "sponsor-portal-access",
        recipientEmail: existing.contact_email,
        messageType: "transactional",
        subject: "Access your sponsor portal",
        data: {
          contactNameText: escapeMarkdownText(existing.contact_name ?? "there"),
          tierText: escapeMarkdownText(existing.tier ?? ""),
          eventNameText: escapeMarkdownText(existing.event_name ?? ""),
          portalUrl,
          expiresInMinutes: params.notifications.magicLinkTtlMinutes,
        },
        capabilityLinkValues: [portalUrl],
      },
      now,
    );
    statements.push(queued.statement);
    outboxIds.push(queued.id);
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) throw sponsorshipChangedError();
    throw error;
  }

  return {
    sponsorship: (await getSponsorship(db, params.id)) as SponsorshipReadModelRow,
    becameActive,
    becameLapsed,
    qualifiesForAttendeeDataAccess,
    outboxIds,
  };
}
