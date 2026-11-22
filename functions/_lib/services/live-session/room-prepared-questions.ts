import {
  LIVE_PREPARED_QUESTION_POLICY,
  LIVE_ROOM_POLICY,
  livePreparedQuestionReleaseAt,
  type LivePreparedQuestionWindow,
} from "../../../../assets/shared/live-session-policy";
import type { LiveRoomServerMessage, LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import { randomFraction } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveControlOutcome, LiveRefusal } from "./room-controls";
import {
  projectLivePreparedQuestion,
  type LivePreparedQuestionRow,
  type LivePreparedQuestionStore,
} from "./room-prepared-question-store";
import { LIVE_QUESTION_REFUSALS, resolveLiveQuestionAddressee } from "./room-questions";
import type { LiveRoomStore } from "./room-store";

type Operator = { userId: string; name: string };

const REFUSALS = {
  missing: { code: "LIVE_PREPARED_QUESTION_NOT_FOUND", message: "That prepared question is no longer waiting." },
  changed: {
    code: "LIVE_PREPARED_QUESTION_CHANGED",
    message: "Another operator changed this question. Review it before saving again.",
  },
  full: {
    code: "LIVE_PREPARED_QUESTION_LIMIT",
    message: `This session already has ${LIVE_PREPARED_QUESTION_POLICY.maxPerRoom} prepared questions waiting.`,
  },
  roomFull: LIVE_QUESTION_REFUSALS.full,
} satisfies Record<string, LiveRefusal>;

/**
 * Questions operators prepare. Each waits, seen by operators only, until a
 * random moment within the release window, or until an operator releases
 * it. It then comes into the open list as an ordinary question: approved,
 * anonymous, without votes and asked at that moment. Only operators are told
 * it was prepared. Prepared questions take no attendee's allowance, but count
 * toward the room's question limit once released.
 */
export class LiveRoomPreparedQuestions {
  constructor(
    private readonly store: LiveRoomStore,
    private readonly prepared: LivePreparedQuestionStore,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly hooks: {
      /** The room's alarm must fire by this epoch-millisecond moment. */
      releaseDue: (at: number) => Promise<void>;
      /** A question changed what an audience list on air may hold. */
      listed: () => void;
      /** The durable copy is due. */
      changed: () => Promise<void>;
    },
  ) {}

  /** What operators see of the waiting questions; overlays, speakers and attendees see none. */
  changedMessage(session: LiveRoomSession): LiveRoomServerMessage {
    return {
      type: "question.prepared.changed",
      preparedQuestions: this.prepared.list().map(projectLivePreparedQuestion),
      window: this.prepared.window(session),
    };
  }

  async prepare(
    operator: Operator,
    session: LiveRoomSession,
    input: { preparedId: string | null; text: string; addressedTo: string | null; expectedRevision?: number },
    at: string,
  ): Promise<LiveControlOutcome> {
    const addressee = resolveLiveQuestionAddressee(session, input.addressedTo);
    if (addressee && "code" in addressee) return addressee;
    if (input.preparedId === null) {
      if (this.prepared.count() >= LIVE_PREPARED_QUESTION_POLICY.maxPerRoom) return REFUSALS.full;
      const id = crypto.randomUUID();
      const releaseAt = this.draw(this.prepared.window(session), Date.now());
      this.prepared.create(id, input.text, addressee, releaseAt, operator, at);
      this.store.recordStaffAction(operator.userId, "live_session.question.prepared", { preparedId: id }, at);
      await this.hooks.releaseDue(Date.parse(releaseAt));
      return { messages: [this.changedMessage(session)] };
    }
    const row = this.prepared.get(input.preparedId);
    if (!row) return REFUSALS.missing;
    if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) return REFUSALS.changed;
    this.prepared.update(row.id, input.text, addressee);
    this.store.recordStaffAction(operator.userId, "live_session.question.prepared.updated", { preparedId: row.id }, at);
    return { messages: [this.changedMessage(session)] };
  }

  remove(operator: Operator, session: LiveRoomSession, preparedId: string, at: string): LiveControlOutcome {
    if (!this.prepared.get(preparedId)) return REFUSALS.missing;
    this.prepared.delete(preparedId);
    this.store.recordStaffAction(operator.userId, "live_session.question.prepared.deleted", { preparedId }, at);
    return { messages: [this.changedMessage(session)] };
  }

  /** "Release now": the question comes into the open list at once. */
  async releaseNow(
    operator: Operator,
    session: LiveRoomSession,
    preparedId: string,
    at: string,
  ): Promise<LiveControlOutcome> {
    const row = this.prepared.get(preparedId);
    if (!row) return REFUSALS.missing;
    if (!(await this.release(row, at))) return REFUSALS.roomFull;
    this.store.recordStaffAction(
      operator.userId,
      "live_session.question.prepared.released",
      { preparedId, questionId: row.id },
      at,
    );
    return { messages: [this.changedMessage(session)] };
  }

  /** Moves the window; every waiting question draws a new release moment within it. */
  async setWindow(
    operator: Operator,
    session: LiveRoomSession,
    window: LivePreparedQuestionWindow,
    at: string,
  ): Promise<LiveControlOutcome> {
    this.prepared.saveWindow(window);
    const now = Date.now();
    for (const row of this.prepared.list()) this.prepared.reschedule(row.id, this.draw(window, now));
    this.store.recordStaffAction(operator.userId, "live_session.question.prepared.window", { ...window }, at);
    // A window already over draws every question for now: they go out at once, as no alarm lies ahead for them.
    await this.releaseDue(session);
    const next = this.nextReleaseAt();
    if (next !== null) await this.hooks.releaseDue(next);
    return { messages: [this.changedMessage(session)] };
  }

  /**
   * Releases every question whose moment has come; the room's alarm calls
   * this whether or not anyone is connected. A question the full room cannot
   * take keeps waiting, and operators can still see it.
   */
  async releaseDue(session: LiveRoomSession): Promise<void> {
    const at = nowIso();
    let released = false;
    for (const { id } of this.prepared.due(at)) {
      // Each release waits on the room's broadcast, so an operator may delete or release the next one meanwhile.
      const row = this.prepared.get(id);
      if (!row) continue;
      if (!(await this.release(row, at))) break;
      released = true;
    }
    if (released) await this.broadcast.all(this.changedMessage(session));
  }

  /** The next release moment still ahead, as epoch milliseconds. */
  nextReleaseAt(): number | null {
    return this.prepared.nextReleaseAfter(nowIso());
  }

  /** Removes the waiting questions an erased operator wrote, and tells the other operators. */
  async forget(session: LiveRoomSession, userId: string): Promise<void> {
    if (this.prepared.forget(userId)) await this.broadcast.all(this.changedMessage(session));
  }

  /**
   * The question takes the prepared id, so one prepared question can come
   * into the list only once. Its operator author is anonymous to everyone
   * but moderators, as any anonymous asker is.
   */
  private async release(row: LivePreparedQuestionRow, at: string): Promise<boolean> {
    if (this.store.questionCount() >= LIVE_ROOM_POLICY.maxQuestionsPerRoom) return false;
    const author = { userId: row.created_by_user_id, name: row.created_by_name };
    this.store.addQuestion({
      id: row.id,
      authorUserId: author.userId,
      authorName: author.name,
      anonymous: true,
      body: row.body,
      askedAt: at,
      authorPhotoUrl: null,
      addressee: row.addressed_to_credit_key
        ? { creditKey: row.addressed_to_credit_key, userId: row.addressed_to_user_id }
        : null,
      prepared: true,
    });
    this.store.moderate(row.id, "approved", author, at);
    this.prepared.delete(row.id);
    await this.broadcast.question(row.id);
    this.hooks.listed();
    await this.hooks.changed();
    return true;
  }

  private draw(window: LivePreparedQuestionWindow, now: number): string {
    return livePreparedQuestionReleaseAt(window, now, randomFraction());
  }
}
