import type { DatabaseLike, StatementLike } from "../../types";
import type { SponsorshipEndReason } from "../../../../assets/shared/sponsorship-logo-policy";

/** These statements belong after the stage CAS/audit guard in the caller's batch. */
export function prepareSponsorshipLogoPeriods(
  db: DatabaseLike,
  input: { id: string; fromStage: string; toStage: string; endReason: SponsorshipEndReason | null; at: string },
): StatementLike[] {
  const statements: StatementLike[] = [];
  if (input.fromStage === "active") {
    // Existing imported rows may have no known start; do not invent an earlier date.
    statements.push(
      db
        .prepare(`INSERT INTO sponsorship_periods
      (id,sponsorship_id,tier,revision,started_at,scheduled_end_at,recorded_at)
      SELECT ?,id,tier,transition_revision,COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',start_date),?),
        strftime('%Y-%m-%dT%H:%M:%fZ',renewal_date),? FROM sponsorships
      WHERE id=? AND NOT EXISTS(SELECT 1 FROM sponsorship_periods WHERE sponsorship_id=? AND ended_at IS NULL)`)
        .bind(crypto.randomUUID(), input.at, input.at, input.id, input.id),
    );
    statements.push(
      db
        .prepare(`UPDATE sponsorship_periods SET ended_at=?,end_reason=?
      WHERE sponsorship_id=? AND ended_at IS NULL`)
        .bind(input.at, input.endReason, input.id),
    );
  }
  if (input.toStage === "active") {
    statements.push(
      db
        .prepare(`INSERT INTO sponsorship_periods
      (id,sponsorship_id,tier,revision,started_at,scheduled_end_at,recorded_at)
      SELECT ?,id,tier,transition_revision,?,strftime('%Y-%m-%dT%H:%M:%fZ',renewal_date),? FROM sponsorships WHERE id=?`)
        .bind(crypto.randomUUID(), input.at, input.at, input.id),
    );
  } else if (input.endReason && input.fromStage !== "active") {
    statements.push(
      db
        .prepare(`UPDATE sponsorship_periods SET end_reason=?
      WHERE sponsorship_id=? AND ended_at IS NOT NULL AND end_reason='ordinary_expiry'`)
        .bind(input.endReason, input.id),
    );
  }
  return statements;
}

/** A tier change closes a period; a renewal updates only the current period's paid-through boundary. */
export function prepareActiveSponsorshipPeriodPatch(
  db: DatabaseLike,
  input: { id: string; tierChanged: boolean; at: string },
): StatementLike[] {
  if (input.tierChanged) {
    return [
      db
        .prepare(`UPDATE sponsorship_periods SET ended_at=?,end_reason='tier_change'
      WHERE sponsorship_id=? AND ended_at IS NULL`)
        .bind(input.at, input.id),
      ...prepareSponsorshipLogoPeriods(db, { ...input, fromStage: "negotiating", toStage: "active", endReason: null }),
    ];
  }
  return [
    db
      .prepare(`UPDATE sponsorship_periods SET scheduled_end_at=(SELECT
    strftime('%Y-%m-%dT%H:%M:%fZ',renewal_date) FROM sponsorships WHERE id=?)
    WHERE sponsorship_id=? AND ended_at IS NULL`)
      .bind(input.id, input.id),
  ];
}
