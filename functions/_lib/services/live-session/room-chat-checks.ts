/**
 * The classifier's verdict on each attendee message, kept beside the
 * chat. Attendees read a message at once and lose it if the check blocks it.
 * Outputs wait: a message stays off air while it is checked, and when the
 * check advised or blocked it, until a moderator keeps it.
 */
import { classifierPercent, type ClassifierModel, type ClassifierOutcome } from "../../../../assets/shared/classifiers";
import {
  liveClassifierVerdictSchema,
  type LiveClassifierVerdict,
} from "../../../../assets/shared/schemas/live-session-moderation";
import type { ClassifierRun } from "../classifiers/model";
import type { LiveRoomSql } from "./room-sql";

/** A check still unanswered after this long no longer keeps its message off air; the model itself gets 4 seconds. */
export const LIVE_CHAT_CHECK_WAIT_MS = 5_000;
/** Who the room names when the classifier holds a message. */
export const LIVE_CHAT_HELD_BY_CHECK = "Classifier";

/** Messages the on-air outputs leave out for their check: flagged, or still being checked. */
export function liveChatCheckHoldsBack(now: number): { sql: string; bindings: string[] } {
  return {
    sql: `id NOT IN (SELECT message_id FROM room_chat_checks
      WHERE outcome IN ('advised', 'blocked') OR (outcome = 'pending' AND at > ?))`,
    bindings: [new Date(now - LIVE_CHAT_CHECK_WAIT_MS).toISOString()],
  };
}

type LiveCheckScore = NonNullable<LiveClassifierVerdict["flags"]>[number];

/** What one check found, kept for tuning whatever moderators decide later. */
export interface LiveCheckResult {
  outcome: ClassifierOutcome;
  model: ClassifierModel | null;
  /** The questions that advised or blocked, most certain first. */
  raised: LiveCheckScore[];
  /** Every question the model answered, raised or not, most certain first. */
  scores: LiveCheckScore[];
}

const byCertainty = (a: LiveCheckScore, b: LiveCheckScore) => b.percent - a.percent;

export function liveCheckResult(run: ClassifierRun): LiveCheckResult {
  return {
    outcome: run.verdict.outcome,
    model: run.model,
    raised: run.verdict.flags.map((flag) => ({ id: flag.id, percent: flag.probabilityPercent })).sort(byCertainty),
    scores: [
      ...Object.entries(run.answers).flatMap(([id, answer]) =>
        answer.kind === "flag" ? [{ id, percent: classifierPercent(answer.probability) }] : [],
      ),
      ...run.verdict.scores.map((score) => ({ id: score.id, percent: score.percent })),
    ].sort(byCertainty),
  };
}

export class LiveChatCheckStore {
  constructor(private readonly sql: LiveRoomSql) {}

  /** The message is being checked; it waits off air until the verdict. */
  pending(messageId: string, at: string): void {
    this.sql.exec(
      `INSERT INTO room_chat_checks(message_id, outcome, notes_json, at) VALUES (?, 'pending', '[]', ?)
       ON CONFLICT(message_id) DO UPDATE SET outcome = 'pending', notes_json = '[]', at = excluded.at`,
      messageId,
      at,
    );
    // New words: what the check found for the old ones no longer stands.
    this.sql.exec("DELETE FROM room_chat_check_results WHERE message_id = ?", messageId);
  }

  /**
   * Keeps what the check found, whether it passed, raised a concern, or got no answer: every score with the model,
   * so the check can be tuned on these words later. A moderator's keep leaves it in place.
   */
  keepResult(messageId: string, result: LiveCheckResult, at: string): void {
    this.sql.exec(
      `INSERT INTO room_chat_check_results(message_id, outcome, model, raised_json, scores_json, at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET outcome = excluded.outcome, model = excluded.model,
         raised_json = excluded.raised_json, scores_json = excluded.scores_json, at = excluded.at`,
      messageId,
      result.outcome,
      result.model,
      JSON.stringify(result.raised),
      JSON.stringify(result.scores),
      at,
    );
  }

  /** The check advised against the message or blocked it: it stays off air until a moderator keeps it. */
  record(messageId: string, outcome: LiveClassifierVerdict["outcome"], notes: string[], at: string): void {
    this.sql.exec(
      `INSERT INTO room_chat_checks(message_id, outcome, notes_json, at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET outcome = excluded.outcome, notes_json = excluded.notes_json, at = excluded.at`,
      messageId,
      outcome,
      JSON.stringify(notes),
      at,
    );
  }

  /** Nothing holds the message back for its check any longer: it passed, or a moderator kept it. */
  clear(messageId: string): void {
    this.sql.exec("DELETE FROM room_chat_checks WHERE message_id = ?", messageId);
  }

  /** How many of one author's attendee messages the check blocked since `since`; kept ones no longer count. */
  blockedSince(authorUserId: string, since: string): number {
    return (
      this.sql.rows<{ blocked: number }>(
        `SELECT COUNT(*) AS blocked FROM room_chat_checks
         JOIN room_chat ON room_chat.id = room_chat_checks.message_id
         WHERE room_chat_checks.outcome = 'blocked' AND room_chat_checks.at >= ? AND room_chat.author_user_id = ?`,
        since,
        authorUserId,
      )[0]?.blocked ?? 0
    );
  }

  /** The flagged messages among `ids`, as moderators see them. */
  flagged(ids: readonly string[]): Map<string, LiveClassifierVerdict> {
    if (!ids.length) return new Map();
    return new Map(
      this.sql
        .rows<{ message_id: string; outcome: "advised" | "blocked"; notes_json: string; flags_json: string | null }>(
          `SELECT message_id, outcome, notes_json,
             (SELECT raised_json FROM room_chat_check_results r WHERE r.message_id = room_chat_checks.message_id) AS flags_json
           FROM room_chat_checks
           WHERE outcome IN ('advised', 'blocked') AND message_id IN (SELECT value FROM json_each(?))`,
          JSON.stringify(ids),
        )
        .map((row) => [
          row.message_id,
          { outcome: row.outcome, notes: readNotes(row.notes_json), flags: readLiveCheckFlags(row.flags_json) },
        ]),
    );
  }
}

/** The stored flags when they still read as the contract's; a room from an earlier release has none. */
export function readLiveCheckFlags(json: string | null): LiveClassifierVerdict["flags"] {
  if (!json) return undefined;
  try {
    const parsed = liveClassifierVerdictSchema.shape.flags.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function readNotes(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((note): note is string => typeof note === "string") : [];
  } catch {
    return [];
  }
}
