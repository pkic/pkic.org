import { readStoredLiveTicker } from "../../../../assets/shared/schemas/live-session-ticker";
import {
  LIVE_ROOM_POLICY,
  type LiveQuestionStatus,
  type LiveReactionId,
} from "../../../../assets/shared/live-session-policy";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_STAGE,
  liveAddedCreditsSchema,
  liveAuxCompositionSchema,
  liveOverlayModeSchema,
  liveQueueSchema,
  liveRoomSessionSchema,
  liveSpeakerMessageSchema,
  liveStageSchema,
  type LiveAuxComposition,
  type LiveCredit,
  type LiveOverlayMode,
  type LiveOutputs,
  type LiveQueue,
  type LiveRoomSession,
  type LiveSpeakerMessage,
  type LiveStage,
  type LiveTimer,
} from "../../../../assets/shared/schemas/live-session-room";
import { LIVE_AUX_OUTPUTS, type LiveAuxOutput } from "../../../../assets/shared/live-room-outputs";
import { liveTimersSchema } from "../../../../assets/shared/schemas/live-session-timer";
import { sessionLiveTimer } from "../../../../assets/shared/live-timer-policy";
import { copyableLivePolls, type LivePollCopy } from "./room-poll-store";
import type { LiveRoomSql } from "./room-sql";

export interface LiveQuestionAuthorChangeRow {
  question_id: string;
  text: string;
  revision: number;
  withdrawn: number;
  operation_id: string;
  operation_type: "question.edit" | "question.withdraw";
  basis_revision: number;
  changed_at: string;
}

export interface LiveQuestionRow {
  id: string;
  author_user_id: string;
  author_name: string;
  anonymous: number;
  body: string;
  submitted_body: string;
  author_revision: number;
  author_withdrawn: number;
  status: LiveQuestionStatus;
  votes: number;
  asked_at: string;
  answered_at: string | null;
  moderated_by_user_id: string | null;
  moderated_by_name: string | null;
  moderated_at: string | null;
  rewrite_text: string | null;
  rewritten_by_user_id: string | null;
  rewritten_by_name: string | null;
  rewritten_at: string | null;
  /** The author's profile photo as they asked; the projection withholds it from an anonymous question. */
  author_photo_url: string | null;
  /** Who the author was as they asked (`LiveAuthorStamp` JSON); withheld like the photo from an anonymous question. */
  author_json: string | null;
  change_seq: number;
}

export interface LiveStaffActionRow {
  seq: number;
  actor_user_id: string;
  action: string;
  details_json: string;
  occurred_at: string;
}

/** Everything changed since the last durable copy. */
export interface LiveRoomPendingCopy {
  eventId: string;
  occurrenceId: string;
  throughSeq: number;
  questions: LiveQuestionRow[];
  polls: LivePollCopy[];
  reactions: Array<{ reaction: string; total: number }>;
  staffActions: LiveStaffActionRow[];
}

const QUESTION_SELECT = `SELECT q.id, q.author_user_id, q.author_name, q.anonymous, COALESCE(author_change.text,q.body) AS body, q.body AS submitted_body,
  COALESCE(author_change.revision,0) AS author_revision, COALESCE(author_change.withdrawn,0) AS author_withdrawn, q.status, q.votes, q.asked_at,
  q.answered_at, q.moderated_by_user_id, q.moderated_by_name, q.moderated_at, r.text AS rewrite_text,
  r.by_user_id AS rewritten_by_user_id, r.by_name AS rewritten_by_name, r.at AS rewritten_at,
  photo.photo_url AS author_photo_url, authorship.author_json, q.change_seq
  FROM questions q LEFT JOIN question_rewrites r ON r.question_id = q.id
  LEFT JOIN question_author_photos photo ON photo.question_id = q.id
  LEFT JOIN question_authorship authorship ON authorship.question_id = q.id
  LEFT JOIN question_author_changes author_change ON author_change.question_id = q.id`;

const EMPTY_QUEUE: LiveQueue = { question: [], "lower-third": [], poll: [], change: null };

/** The room's session, questions, reactions, controls and the bookkeeping of its durable copy. */
export class LiveRoomStore {
  constructor(private readonly sql: LiveRoomSql) {}

  saveSession(eventId: string, session: LiveRoomSession): void {
    this.sql.exec(
      "INSERT INTO room_session(id, event_id, session_json) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET event_id = excluded.event_id, session_json = excluded.session_json",
      eventId,
      JSON.stringify(session),
    );
  }

  session(): { eventId: string; session: LiveRoomSession } | null {
    const [row] = this.sql.rows<{ event_id: string; session_json: string }>(
      "SELECT event_id, session_json FROM room_session WHERE id = 1",
    );
    return row ? { eventId: row.event_id, session: liveRoomSessionSchema.parse(JSON.parse(row.session_json)) } : null;
  }

  question(id: string): LiveQuestionRow | null {
    return this.sql.rows<LiveQuestionRow>(`${QUESTION_SELECT} WHERE q.id = ?`, id)[0] ?? null;
  }

  /** A rolling question-write allowance survives room hibernation/restarts; expired times have no history role. */
  takeQuestionWriteAllowance(userId: string, at: string): boolean {
    const policy = LIVE_ROOM_POLICY.questionsPerPerson;
    const since = new Date(Date.parse(at) - policy.windowSeconds * 1000).toISOString();
    this.sql.exec("DELETE FROM question_write_times WHERE accepted_at<=?", since);
    const [{ total }] = this.sql.rows<{ total: number }>(
      "SELECT COUNT(*) AS total FROM question_write_times WHERE user_id=?",
      userId,
    );
    if (total >= policy.limit) return false;
    this.sql.exec(
      "INSERT INTO question_write_times(id,user_id,accepted_at) VALUES(?,?,?)",
      crypto.randomUUID(),
      userId,
      at,
    );
    return true;
  }

  authorChange(questionId: string): LiveQuestionAuthorChangeRow | null {
    return (
      this.sql.rows<LiveQuestionAuthorChangeRow>(
        "SELECT question_id,text,revision,withdrawn,operation_id,operation_type,basis_revision,changed_at FROM question_author_changes WHERE question_id=?",
        questionId,
      )[0] ?? null
    );
  }

  saveAuthorChange(row: LiveQuestionAuthorChangeRow): void {
    this.sql.exec(
      `INSERT INTO question_author_changes(question_id,text,revision,withdrawn,operation_id,operation_type,basis_revision,changed_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET text=excluded.text,revision=excluded.revision,
      withdrawn=excluded.withdrawn,operation_id=excluded.operation_id,operation_type=excluded.operation_type,
      basis_revision=excluded.basis_revision,changed_at=excluded.changed_at`,
      row.question_id,
      row.text,
      row.revision,
      row.withdrawn,
      row.operation_id,
      row.operation_type,
      row.basis_revision,
      row.changed_at,
    );
    this.sql.exec(
      "UPDATE questions SET status=CASE WHEN ?=1 THEN 'hidden' ELSE status END, change_seq=? WHERE id=?",
      row.withdrawn,
      this.sql.nextChange(),
      row.question_id,
    );
  }

  /** All questions, most voted first, newest first on a tie (the shared `top` order). */
  questions(): LiveQuestionRow[] {
    return this.sql.rows<LiveQuestionRow>(`${QUESTION_SELECT} ORDER BY q.votes DESC, q.asked_at DESC, q.id`);
  }

  questionCount(): number {
    return this.sql.rows<{ total: number }>("SELECT COUNT(*) AS total FROM questions")[0].total;
  }

  votedQuestionIds(userId: string): Set<string> {
    return new Set(
      this.sql
        .rows<{ question_id: string }>("SELECT question_id FROM question_votes WHERE user_id = ?", userId)
        .map((row) => row.question_id),
    );
  }

  hasVoted(questionId: string, userId: string): boolean {
    return (
      this.sql.rows("SELECT 1 FROM question_votes WHERE question_id = ? AND user_id = ?", questionId, userId).length > 0
    );
  }

  addQuestion(question: {
    id: string;
    authorUserId: string;
    authorName: string;
    anonymous: boolean;
    body: string;
    askedAt: string;
    /** Kept only for a question asked by name; an anonymous one never stores a photo. */
    authorPhotoUrl: string | null;
  }): void {
    this.sql.exec(
      "INSERT INTO questions(id, author_user_id, author_name, anonymous, body, status, votes, asked_at, change_seq) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
      question.id,
      question.authorUserId,
      question.authorName,
      question.anonymous ? 1 : 0,
      question.body,
      question.askedAt,
      this.sql.nextChange(),
    );
    if (!question.anonymous && question.authorPhotoUrl)
      this.sql.exec(
        "INSERT INTO question_author_photos(question_id, photo_url) VALUES (?, ?)",
        question.id,
        question.authorPhotoUrl,
      );
  }

  /** One vote per person: records or withdraws it and recounts. */
  setVote(questionId: string, userId: string, voted: boolean): void {
    if (voted)
      this.sql.exec("INSERT OR IGNORE INTO question_votes(question_id, user_id) VALUES (?, ?)", questionId, userId);
    else this.sql.exec("DELETE FROM question_votes WHERE question_id = ? AND user_id = ?", questionId, userId);
    this.recountQuestion(questionId);
  }

  private recountQuestion(questionId: string): void {
    this.sql.exec(
      "UPDATE questions SET votes = (SELECT COUNT(*) FROM question_votes WHERE question_id = ?), change_seq = ? WHERE id = ?",
      questionId,
      this.sql.nextChange(),
      questionId,
    );
  }

  moderate(questionId: string, status: LiveQuestionStatus, by: { userId: string; name: string }, at: string): void {
    this.sql.exec(
      `UPDATE questions SET status = ?, answered_at = CASE WHEN ? = 'answered' THEN ? ELSE NULL END,
       moderated_by_user_id = ?, moderated_by_name = ?, moderated_at = ?, change_seq = ? WHERE id = ?`,
      status,
      status,
      at,
      by.userId,
      by.name,
      at,
      this.sql.nextChange(),
      questionId,
    );
  }

  /** Replaces the shown text; the author's own words stay in `body`. */
  rewrite(questionId: string, text: string, by: { userId: string; name: string }, at: string): void {
    this.sql.exec(
      `INSERT INTO question_rewrites(question_id, text, by_user_id, by_name, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET text = excluded.text, by_user_id = excluded.by_user_id, by_name = excluded.by_name, at = excluded.at`,
      questionId,
      text,
      by.userId,
      by.name,
      at,
    );
    this.sql.exec("UPDATE questions SET change_seq = ? WHERE id = ?", this.sql.nextChange(), questionId);
  }

  /**
   * Erases a person from the room's questions: their own questions go, and
   * their votes are withdrawn. Returns what changed so viewers can be told.
   */
  forgetQuestions(userId: string): { removed: string[]; recounted: string[] } {
    const removed = this.sql
      .rows<{ id: string }>("SELECT id FROM questions WHERE author_user_id = ?", userId)
      .map((row) => row.id);
    const recounted = this.sql
      .rows<{ question_id: string }>("SELECT question_id FROM question_votes WHERE user_id = ?", userId)
      .map((row) => row.question_id)
      .filter((id) => !removed.includes(id));
    this.sql.exec(
      "DELETE FROM question_votes WHERE user_id = ? OR question_id IN (SELECT id FROM questions WHERE author_user_id = ?)",
      userId,
      userId,
    );
    this.sql.exec(
      "DELETE FROM question_rewrites WHERE question_id IN (SELECT id FROM questions WHERE author_user_id = ?)",
      userId,
    );
    this.sql.exec(
      "DELETE FROM question_author_photos WHERE question_id IN (SELECT id FROM questions WHERE author_user_id = ?)",
      userId,
    );
    this.sql.exec(
      "DELETE FROM question_author_changes WHERE question_id IN (SELECT id FROM questions WHERE author_user_id=?)",
      userId,
    );
    this.sql.exec("DELETE FROM question_write_times WHERE user_id=?", userId);
    this.sql.exec("DELETE FROM questions WHERE author_user_id = ?", userId);
    for (const id of recounted) this.recountQuestion(id);
    return { removed, recounted };
  }

  addReaction(reaction: LiveReactionId): void {
    this.sql.exec(
      "INSERT INTO reaction_totals(reaction, total, change_seq) VALUES (?, 1, ?) ON CONFLICT(reaction) DO UPDATE SET total = total + 1, change_seq = excluded.change_seq",
      reaction,
      this.sql.nextChange(),
    );
  }

  reactionTotals(): Partial<Record<LiveReactionId, number>> {
    return Object.fromEntries(
      this.sql
        .rows<{ reaction: LiveReactionId; total: number }>("SELECT reaction, total FROM reaction_totals")
        .map((row) => [row.reaction, row.total]),
    );
  }

  stage(): LiveStage {
    // A stage saved before polls existed carries no poll fields yet.
    const saved = this.control("stage");
    if (!saved) return EMPTY_LIVE_STAGE;
    const stage = { ...EMPTY_LIVE_STAGE, ...(saved as object) };
    return liveStageSchema.parse({ ...stage, ticker: readStoredLiveTicker(stage.ticker) });
  }

  saveStage(stage: LiveStage): void {
    this.saveControl("stage", liveStageSchema.parse(stage));
  }

  /** One auxiliary output's composition; an output nobody composed yet shows nothing. */
  aux(output: LiveAuxOutput): LiveAuxComposition {
    const saved = this.control(`aux:${output}`);
    return saved ? liveAuxCompositionSchema.parse(saved) : EMPTY_LIVE_AUX_COMPOSITION;
  }

  saveAux(output: LiveAuxOutput, composition: LiveAuxComposition): void {
    this.saveControl(`aux:${output}`, liveAuxCompositionSchema.parse(composition));
  }

  outputs(): LiveOutputs {
    return Object.fromEntries(LIVE_AUX_OUTPUTS.map((output) => [output, this.aux(output)])) as LiveOutputs;
  }

  /**
   * The operators' one shared Preview. Until anyone changes it, it shows what
   * Program shows, so a fresh desk starts in sync.
   */
  preview(): LiveAuxComposition {
    const saved = this.control("preview");
    if (saved) return liveAuxCompositionSchema.parse(saved);
    return this.stage();
  }

  savePreview(composition: LiveAuxComposition): void {
    this.saveControl("preview", liveAuxCompositionSchema.parse(composition));
  }

  /** Whether Program or any auxiliary output shows this poll's results; Preview is not on air. */
  pollOnAir(pollId: string): boolean {
    return this.stage().poll?.id === pollId || LIVE_AUX_OUTPUTS.some((output) => this.aux(output).poll?.id === pollId);
  }

  speakerMessage(): LiveSpeakerMessage | null {
    const saved = this.control("speakerMessage");
    return saved ? liveSpeakerMessageSchema.parse(saved) : null;
  }

  saveSpeakerMessage(message: LiveSpeakerMessage | null): void {
    this.saveControl("speakerMessage", message === null ? null : liveSpeakerMessageSchema.parse(message));
  }

  queue(): LiveQueue {
    const saved = this.control("queue");
    return saved ? liveQueueSchema.parse(saved) : EMPTY_QUEUE;
  }

  saveQueue(queue: LiveQueue): void {
    this.saveControl("queue", liveQueueSchema.parse(queue));
  }

  /** The room's timers; a room nobody timed yet has the one that follows the session. */
  timers(session: LiveRoomSession): LiveTimer[] {
    const saved = this.control("timers");
    return saved ? liveTimersSchema.parse(saved) : [sessionLiveTimer(session)];
  }

  saveTimers(timers: readonly LiveTimer[]): void {
    this.saveControl("timers", liveTimersSchema.parse(timers));
  }

  /** The people operators added to this session's lower thirds, oldest first. */
  addedCredits(): LiveCredit[] {
    const saved = this.control("addedCredits");
    return saved ? liveAddedCreditsSchema.parse(saved) : [];
  }

  saveAddedCredits(credits: readonly LiveCredit[]): void {
    this.saveControl("addedCredits", liveAddedCreditsSchema.parse(credits));
  }

  /** The Program the latest clear took off air, for an Undo; null once restored or replaced. */
  programUndo(): { id: string; stage: LiveStage } | null {
    const saved = this.control("programUndo") as { id?: unknown; stage?: unknown } | null;
    if (!saved || typeof saved.id !== "string") return null;
    const stage = liveStageSchema.safeParse(saved.stage);
    return stage.success ? { id: saved.id, stage: stage.data } : null;
  }

  saveProgramUndo(undo: { id: string; stage: LiveStage } | null): void {
    this.saveControl("programUndo", undo === null ? null : { id: undo.id, stage: liveStageSchema.parse(undo.stage) });
  }

  overlayMode(): LiveOverlayMode {
    return liveOverlayModeSchema.parse(this.control("overlayMode") ?? "direct");
  }

  saveOverlayMode(mode: LiveOverlayMode): void {
    this.saveControl("overlayMode", mode);
  }

  private control(name: string): unknown {
    const [row] = this.sql.rows<{ value_json: string }>("SELECT value_json FROM room_controls WHERE name = ?", name);
    return row ? JSON.parse(row.value_json) : null;
  }

  private saveControl(name: string, value: unknown): void {
    this.sql.exec(
      "INSERT INTO room_controls(name, value_json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value_json = excluded.value_json",
      name,
      JSON.stringify(value),
    );
  }

  /** A staff action waits here until the durable copy writes its audit row. */
  recordStaffAction(actorUserId: string, action: string, details: Record<string, unknown>, at: string): void {
    this.sql.exec(
      "INSERT INTO staff_actions(actor_user_id, action, details_json, occurred_at) VALUES (?, ?, ?, ?)",
      actorUserId,
      action,
      JSON.stringify(details),
      at,
    );
  }

  pendingCopy(): LiveRoomPendingCopy | null {
    const room = this.session();
    if (!room) return null;
    const [{ change_seq: throughSeq, copied_seq: copiedSeq }] = this.sql.rows<{
      change_seq: number;
      copied_seq: number;
    }>("SELECT change_seq, copied_seq FROM copy_state WHERE id = 1");
    const staffActions = this.sql.rows<LiveStaffActionRow>(
      "SELECT seq, actor_user_id, action, details_json, occurred_at FROM staff_actions ORDER BY seq",
    );
    if (throughSeq === copiedSeq && staffActions.length === 0) return null;
    return {
      eventId: room.eventId,
      occurrenceId: room.session.occurrenceId,
      throughSeq,
      questions: this.sql.rows<LiveQuestionRow>(
        `${QUESTION_SELECT} WHERE q.change_seq > ? ORDER BY q.change_seq`,
        copiedSeq,
      ),
      polls: copyableLivePolls(this.sql, copiedSeq),
      reactions: this.sql.rows("SELECT reaction, total FROM reaction_totals WHERE change_seq > ?", copiedSeq),
      staffActions,
    };
  }

  markCopied(copy: LiveRoomPendingCopy): void {
    this.sql.exec("UPDATE copy_state SET copied_seq = MAX(copied_seq, ?) WHERE id = 1", copy.throughSeq);
    const lastAction = copy.staffActions.at(-1);
    if (lastAction) this.sql.exec("DELETE FROM staff_actions WHERE seq <= ?", lastAction.seq);
  }

  hasPendingCopy(): boolean {
    return this.pendingCopy() !== null;
  }
}
