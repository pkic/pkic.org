import {
  eventParticipationSchema,
  type EventParticipation,
} from "../../../../assets/shared/schemas/event-participation";
import { batchFirst, batchRows } from "../../db/pagination";
import { prepareEventProposalCall, type EventProposalCallRow } from "./proposal-call";
import { eventReadSelectionSql, type EventReadSelection } from "./read-selection";
import type { DatabaseLike } from "../../types";
import { firstReferralCodeForOwnerSql } from "../referral-code-projection";
import { personalPromotionSharePath } from "../../../../assets/shared/personal-promotion-image";

export interface EventParticipationRow {
  id: string;
  registrationId: string | null;
  registrationStatus: string | null;
  referralCode?: string | null;
  registrationUpdatedAt?: string | null;
  proposalStates: string;
  speakerStates: string;
  proposals: number;
  speakerProposals: number;
}

export function prepareEventParticipation(db: DatabaseLike, userId: string | null, selection: EventReadSelection) {
  const filter = eventReadSelectionSql("e.id", selection);
  return db
    .prepare(
      `${filter.withSql ? `WITH ${filter.withSql} ` : ""}SELECT e.id, r.id AS registrationId, r.status AS registrationStatus,
      CASE WHEN r.status='registered' THEN ${firstReferralCodeForOwnerSql("registration", "r.id", "r.event_id")} END AS referralCode,
      r.updated_at AS registrationUpdatedAt,
      (SELECT group_concat(DISTINCT p.status) FROM session_proposals p WHERE p.event_id = e.id AND p.deleted_at IS NULL AND p.proposer_user_id = ?) AS proposalStates,
      (SELECT group_concat(DISTINCT ps.status) FROM proposal_speakers ps JOIN session_proposals p ON p.id = ps.proposal_id AND p.deleted_at IS NULL WHERE p.event_id = e.id AND ps.user_id = ?) AS speakerStates,
      (SELECT COUNT(*) FROM session_proposals p WHERE p.event_id = e.id AND p.deleted_at IS NULL
        AND p.proposer_user_id = ?) AS proposals,
      (SELECT COUNT(*) FROM proposal_speakers ps JOIN session_proposals p
        ON p.id = ps.proposal_id AND p.deleted_at IS NULL WHERE p.event_id = e.id AND ps.user_id = ?) AS speakerProposals
      FROM events e LEFT JOIN registrations r ON r.event_id = e.id AND r.user_id = ?
      WHERE ${filter.sql}`,
    )
    .bind(
      ...(filter.withSql ? filter.bindings : []),
      userId,
      userId,
      userId,
      userId,
      userId,
      ...(filter.withSql ? [] : filter.bindings),
    );
}

export function decodeEventParticipation(rows: EventParticipationRow[]) {
  const result = new Map<string, EventParticipation>();
  for (const row of rows)
    result.set(
      row.id,
      eventParticipationSchema.parse({
        ...row,
        promotion:
          row.referralCode && row.registrationUpdatedAt
            ? { sharePath: personalPromotionSharePath(row.referralCode), badgeVersion: row.registrationUpdatedAt }
            : null,
        proposalStates: row.proposalStates?.split(",") ?? [],
        speakerStates: row.speakerStates?.split(",") ?? [],
      }),
    );
  return result;
}

export async function fetchEventParticipation(db: DatabaseLike, userId: string | null, eventIds: readonly string[]) {
  if (!userId || !eventIds.length) return new Map<string, EventParticipation>();
  return decodeEventParticipation(
    (await prepareEventParticipation(db, userId, eventIds).all<EventParticipationRow>()).results,
  );
}

/** The event page's independent participation and public proposal-call projections share one read batch. */
export async function readEventParticipationSummary(db: DatabaseLike, userId: string | null, eventId: string) {
  const proposalCall = prepareEventProposalCall(db, eventId);
  const results = await db.batch([
    proposalCall.statement,
    ...(userId ? [prepareEventParticipation(db, userId, [eventId])] : []),
  ]);
  return {
    proposalCall: proposalCall.decode(batchFirst<EventProposalCallRow>(results[0])),
    participation: userId
      ? decodeEventParticipation(batchRows<EventParticipationRow>(results[1])).get(eventId)
      : undefined,
  };
}
