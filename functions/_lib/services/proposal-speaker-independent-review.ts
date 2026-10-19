import type {
  IndependentCapacityReview,
  independentCapacityDecisionSchema,
} from "../../../assets/shared/schemas/independent-capacity";
import type { z } from "zod";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { first } from "../db/queries";
import { prepareQueueEmailStatement } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { buildEventEmailVariables, getEventById } from "./events";
import { speakerManagePageUrl } from "./frontend-links";
import { requireProposalSpeakerPermission } from "./proposal-speaker-access";
import {
  currentIndependentDisclosureColumns,
  toIndependentCapacityReview,
} from "./proposal-speaker-independent-disclosure";
import { queuedSpeakerManageToken } from "./proposal-speakers";

type Decision = z.infer<typeof independentCapacityDecisionSchema>["decision"];

interface ReviewTarget {
  disclosure_id: string;
  review_status: string;
  proposal_speaker_id: string;
  manage_link_secret: string | null;
  event_id: string;
  title: string;
  email: string;
  first_name: string | null;
}

/**
 * A reviewer's decision on an independent speaker's current disclosure:
 * verified, or organizational representation requested — which emails the
 * speaker their representation link. One compare-and-set, audited, with the
 * email in the same batch.
 */
export async function reviewIndependentDisclosure(
  db: DatabaseLike,
  input: { proposalId: string; userId: string; decision: Decision; actor: AuthAdmin; appBaseUrl: string },
): Promise<{ review: IndependentCapacityReview; outboxId: string | null }> {
  const target = await first<ReviewTarget>(
    db,
    `SELECT disclosure.id AS disclosure_id,disclosure.review_status,speaker.id AS proposal_speaker_id,
            speaker.manage_link_secret,proposal.event_id,proposal.title,u.email,u.first_name
     FROM session_proposals proposal
     JOIN proposal_speakers speaker ON speaker.proposal_id=proposal.id AND speaker.user_id=?
     JOIN users u ON u.id=speaker.user_id
     JOIN proposal_speaker_independent_disclosures disclosure
       ON disclosure.proposal_speaker_id=speaker.id AND disclosure.superseded_at IS NULL
     WHERE proposal.id=? AND proposal.deleted_at IS NULL`,
    [input.userId, input.proposalId],
  );
  if (!target)
    throw new AppError(404, "INDEPENDENT_DISCLOSURE_NOT_FOUND", "This speaker has no current independence disclosure.");
  await requireProposalSpeakerPermission(db, input.actor, target.event_id, "manage");
  const at = nowIso();
  const statements: StatementLike[] = [
    preparePermissionsAuthorizationGuard(db, input.actor, [
      { permission: "proposals:manage", context: { type: "event", id: target.event_id } },
    ]),
    db
      .prepare(
        `UPDATE proposal_speaker_independent_disclosures SET review_status=?,reviewed_by=?,reviewed_at=?
         WHERE id=? AND superseded_at IS NULL AND review_status=?`,
      )
      .bind(input.decision, input.actor.id, at, target.disclosure_id, target.review_status),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "proposal", id: input.proposalId },
      "admin",
      input.actor.id,
      input.decision === "verified" ? "independent_capacity_verified" : "independent_capacity_representation_requested",
      "proposal_speaker",
      target.proposal_speaker_id,
      { disclosureId: target.disclosure_id, from: target.review_status, to: input.decision },
      at,
    ),
  ];
  let outboxId: string | null = null;
  if (input.decision === "representation_requested") {
    const event = await getEventById(db, target.event_id);
    const speakerManageUrl = speakerManagePageUrl(
      input.appBaseUrl,
      event,
      await queuedSpeakerManageToken(db, target.proposal_speaker_id, target.manage_link_secret),
    );
    const email = prepareQueueEmailStatement(db, {
      eventId: event.id,
      baseUrl: input.appBaseUrl,
      templateKey: "proposal_organizational_representation_request",
      recipientEmail: target.email,
      recipientUserId: input.userId,
      messageType: "transactional",
      subject: `Please speak on behalf of your organization — ${event.name}`,
      capabilityLinkValues: [speakerManageUrl],
      data: {
        ...buildEventEmailVariables(event, input.appBaseUrl),
        firstName: emailPlainText(target.first_name ?? ""),
        proposalTitle: emailPlainText(target.title),
        speakerManageUrl,
      },
    });
    statements.push(email.statement);
    outboxId = email.id;
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error))
      throw new AppError(409, "INDEPENDENT_DISCLOSURE_CHANGED", "The disclosure changed while it was reviewed.");
    throw error;
  }
  const row = await first<Parameters<typeof toIndependentCapacityReview>[0]>(
    db,
    `SELECT ${currentIndependentDisclosureColumns} FROM proposal_speaker_independent_disclosures disclosure
     LEFT JOIN users reviewer ON reviewer.id=disclosure.reviewed_by WHERE disclosure.id=?`,
    [target.disclosure_id],
  );
  return { review: toIndependentCapacityReview(row!), outboxId };
}
