import type { LivePollStatus } from "../../../../assets/shared/live-session-policy";
import {
  livePollFieldSchema,
  type LivePollDraft,
  type LivePollField,
} from "../../../../assets/shared/schemas/live-session-poll";
import type { CustomAnswerValue } from "../../../../assets/shared/form-answer-rules";
import type { LiveRoomSql } from "./room-sql";

interface LivePollRow {
  id: string;
  field_json: string;
  show_results: number;
  status: LivePollStatus;
  respondents: number;
  created_by_user_id: string;
  created_at: string;
  opened_at: string | null;
  opened_by_user_id: string | null;
  closed_at: string | null;
  closed_by_user_id: string | null;
  changed_by_name: string;
  changed_at: string;
  change_seq: number;
}

export interface LivePollRecord extends Omit<LivePollRow, "field_json"> {
  field: LivePollField;
  /** Answers counted per stored value; a multiple choice counts each value chosen. */
  tallies: Map<string, number>;
}

/** An opened or closed poll as the durable copy writes it; drafts never leave the room. */
export type LivePollCopy = LivePollRecord;

type Operator = { userId: string; name: string };

const POLL_COLUMNS = `id, field_json, show_results, status, respondents, created_by_user_id, created_at, opened_at,
  opened_by_user_id, closed_at, closed_by_user_id, changed_by_name, changed_at, change_seq`;

function withTallies(sql: LiveRoomSql, polls: LivePollRow[]): LivePollRecord[] {
  if (!polls.length) return [];
  const tallies = sql.rows<{ poll_id: string; value: string; votes: number }>(
    `SELECT poll_id, value, votes FROM session_poll_tallies WHERE poll_id IN (${polls.map(() => "?").join(",")})`,
    ...polls.map((poll) => poll.id),
  );
  return polls.map(({ field_json, ...poll }) => ({
    ...poll,
    // The room wrote this field through the same contract, so it reads back whole.
    field: livePollFieldSchema.parse(JSON.parse(field_json)),
    tallies: new Map(tallies.filter((row) => row.poll_id === poll.id).map((row) => [row.value, row.votes])),
  }));
}

/** Polls opened or closed since the last durable copy, with their tallies. */
export function copyableLivePolls(sql: LiveRoomSql, copiedSeq: number): LivePollCopy[] {
  return withTallies(
    sql,
    sql.rows<LivePollRow>(
      `SELECT ${POLL_COLUMNS} FROM session_polls WHERE status != 'draft' AND change_seq > ? ORDER BY change_seq`,
      copiedSeq,
    ),
  );
}

/**
 * A room's polls. Ballots remain until participant erasure or room purge,
 * so closing and reopening preserves one changeable answer per participant.
 */
export class LivePollStore {
  constructor(private readonly sql: LiveRoomSql) {}

  poll(id: string): LivePollRecord | null {
    const [row] = this.sql.rows<LivePollRow>(`SELECT ${POLL_COLUMNS} FROM session_polls WHERE id = ?`, id);
    return row ? withTallies(this.sql, [row])[0] : null;
  }

  /** Every poll in the order it was prepared. */
  polls(): LivePollRecord[] {
    return withTallies(
      this.sql,
      this.sql.rows<LivePollRow>(`SELECT ${POLL_COLUMNS} FROM session_polls ORDER BY created_at, id`),
    );
  }

  pollCount(): number {
    return this.sql.rows<{ total: number }>("SELECT COUNT(*) AS total FROM session_polls")[0].total;
  }

  openPollId(): string | null {
    return this.sql.rows<{ id: string }>("SELECT id FROM session_polls WHERE status = 'open' LIMIT 1")[0]?.id ?? null;
  }

  create(id: string, draft: LivePollDraft, by: Operator, at: string): void {
    this.sql.exec(
      `INSERT INTO session_polls(id, field_json, show_results, status, created_by_user_id, created_at, changed_by_name, changed_at, change_seq)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      id,
      JSON.stringify(draft.field),
      draft.showResults ? 1 : 0,
      by.userId,
      at,
      by.name,
      at,
      this.sql.nextChange(),
    );
  }

  /** Rewrites a draft's question and setting; nobody has answered a draft. */
  updateDraft(id: string, draft: LivePollDraft, by: Operator, at: string): void {
    this.sql.exec(
      `UPDATE session_polls SET field_json = ?, show_results = ?, changed_by_name = ?, changed_at = ?, change_seq = ?
       WHERE id = ? AND status = 'draft'`,
      JSON.stringify(draft.field),
      draft.showResults ? 1 : 0,
      by.name,
      at,
      this.sql.nextChange(),
      id,
    );
  }

  /**
   * Rewrites an opened poll's question. Answers stay with their choice's
   * value; the answers for removed values are withdrawn — a multiple-choice
   * ballot loses only those values — and the tallies recounted.
   */
  updateLive(id: string, draft: LivePollDraft, removedValues: readonly string[], by: Operator, at: string): void {
    this.sql.exec(
      `UPDATE session_polls SET field_json = ?, show_results = ?, changed_by_name = ?, changed_at = ?, change_seq = ?
       WHERE id = ? AND status != 'draft'`,
      JSON.stringify(draft.field),
      draft.showResults ? 1 : 0,
      by.name,
      at,
      this.sql.nextChange(),
      id,
    );
    if (!removedValues.length) return;
    const removed = JSON.stringify(removedValues);
    this.sql.exec(
      `UPDATE session_poll_ballots SET answer_json = (
         SELECT json_group_array(j.value) FROM json_each(session_poll_ballots.answer_json) j
         WHERE CAST(j.value AS TEXT) NOT IN (SELECT value FROM json_each(?)))
       WHERE poll_id = ? AND json_type(answer_json) = 'array'`,
      removed,
      id,
    );
    this.sql.exec(
      `DELETE FROM session_poll_ballots WHERE poll_id = ? AND (
         (json_type(answer_json) = 'array' AND json_array_length(answer_json) = 0)
         OR (json_type(answer_json) != 'array' AND CAST(json_extract(answer_json, '$') AS TEXT) IN (SELECT value FROM json_each(?))))`,
      id,
      removed,
    );
    this.recount(id);
  }

  deleteDraft(id: string): void {
    this.sql.exec("DELETE FROM session_polls WHERE id = ? AND status = 'draft'", id);
  }

  setStatus(id: string, status: "open" | "closed", by: Operator, at: string): void {
    this.sql.exec(
      `UPDATE session_polls SET status = ?,
         opened_at = CASE WHEN ? = 'open' THEN ? ELSE opened_at END,
         opened_by_user_id = CASE WHEN ? = 'open' THEN ? ELSE opened_by_user_id END,
         closed_at = CASE WHEN ? = 'closed' THEN ? ELSE closed_at END,
         closed_by_user_id = CASE WHEN ? = 'closed' THEN ? ELSE closed_by_user_id END,
         changed_by_name = ?, changed_at = ?, change_seq = ?
       WHERE id = ?`,
      status,
      status,
      at,
      status,
      by.userId,
      status,
      at,
      status,
      by.userId,
      by.name,
      at,
      this.sql.nextChange(),
      id,
    );
    // Retain ballots until room erasure/purge so reopening preserves one answer per participant.
  }

  /** This person's answer in each open poll. */
  answers(userId: string): Map<string, CustomAnswerValue> {
    return new Map(
      this.sql
        .rows<{ poll_id: string; answer_json: string }>(
          "SELECT poll_id, answer_json FROM session_poll_ballots WHERE user_id = ?",
          userId,
        )
        .map((row) => [row.poll_id, JSON.parse(row.answer_json) as CustomAnswerValue]),
    );
  }

  /** Every person's answer in one poll as its stored JSON, keyed by user. */
  ballots(pollId: string): Map<string, string> {
    return new Map(
      this.sql
        .rows<{ user_id: string; answer_json: string }>(
          "SELECT user_id, answer_json FROM session_poll_ballots WHERE poll_id = ?",
          pollId,
        )
        .map((row) => [row.user_id, row.answer_json]),
    );
  }

  /** One answer per person, changeable while the poll is open; the tallies are recounted from the ballots. */
  vote(pollId: string, userId: string, answer: CustomAnswerValue): void {
    this.sql.exec(
      `INSERT INTO session_poll_ballots(poll_id, user_id, answer_json) VALUES (?, ?, ?)
       ON CONFLICT(poll_id, user_id) DO UPDATE SET answer_json = excluded.answer_json`,
      pollId,
      userId,
      JSON.stringify(answer),
    );
    this.recount(pollId);
  }

  /** Counts each chosen value once per ballot: a scalar answer is one value, a multiple choice each of its values. */
  private recount(pollId: string): void {
    this.sql.exec("DELETE FROM session_poll_tallies WHERE poll_id = ?", pollId);
    this.sql.exec(
      `INSERT INTO session_poll_tallies(poll_id, value, votes)
       SELECT b.poll_id, CAST(j.value AS TEXT), COUNT(*) FROM session_poll_ballots b, json_each(b.answer_json) j
       WHERE b.poll_id = ? GROUP BY CAST(j.value AS TEXT)`,
      pollId,
    );
    this.sql.exec(
      `UPDATE session_polls SET respondents = (SELECT COUNT(*) FROM session_poll_ballots WHERE poll_id = ?), change_seq = ?
       WHERE id = ?`,
      pollId,
      this.sql.nextChange(),
      pollId,
    );
  }

  /** Withdraws a person's answers from every open poll; returns the polls whose tallies changed. */
  forget(userId: string): string[] {
    const polls = this.sql
      .rows<{ poll_id: string }>("SELECT poll_id FROM session_poll_ballots WHERE user_id = ?", userId)
      .map((row) => row.poll_id);
    this.sql.exec("DELETE FROM session_poll_ballots WHERE user_id = ?", userId);
    for (const pollId of polls) this.recount(pollId);
    return polls;
  }
}
