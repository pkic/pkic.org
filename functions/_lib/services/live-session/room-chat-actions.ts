import {
  LIVE_CHAT_POLICY,
  liveChatActions,
  liveChatCanSend,
  liveChatCapacity,
  liveChatPlainText,
  type LiveChatAction,
  type LiveChatReactionId,
} from "../../../../assets/shared/live-chat-policy";
import type { LiveModerationReason } from "../../../../assets/shared/live-moderation-policy";
import { LIVE_ROOM_POLICY, takeLiveAllowance } from "../../../../assets/shared/live-session-policy";
import type { LiveChatChannel } from "../../../../assets/shared/schemas/live-session-chat";
import type { LiveRoomClientMessage, LiveRoomServerMessage } from "../../../../assets/shared/schemas/live-session-room";
import { nowIso } from "../../utils/time";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveChatRow, LiveRoomChat } from "./room-chat";
import { liveChatChannelVisible, type LiveChatFeed } from "./room-chat-feed";
import type { LiveRefusal } from "./room-controls";
import { serializeLiveRoomMessage } from "./room-projection";
import type { LiveRoomStore } from "./room-store";
import type { LiveRoomAuthors } from "./room-authors";
import { LIVE_PARTICIPATION_REFUSAL } from "./room-participation-refusal";
import { chatAudienceKey, seesChatOccurrence } from "./room-chat-audience";
import type { LiveChatQuestion } from "./location-chat-on-air";
import type { LiveRoomClassifiers } from "./room-classifiers";
import { LIVE_CHAT_CHECK_WAIT_MS, LIVE_CHAT_HELD_BY_CHECK, liveCheckResult } from "./room-chat-checks";

type ChatCommand = Extract<LiveRoomClientMessage, { type: `chat.${string}` }>;
type Actor = { userId: string; name: string };
type Allowance = "reaction" | "report" | "history" | "author" | "edit";

const REFUSALS = {
  missing: { code: "LIVE_CHAT_MESSAGE_NOT_FOUND", message: "That message is no longer available." },
  notAllowed: { code: "LIVE_CHAT_NOT_ALLOWED", message: "You can't do that with this message." },
  blocked: LIVE_PARTICIPATION_REFUSAL,
  tooFast: { code: "LIVE_CHAT_RATE_LIMITED", message: "Wait a moment before sending another chat message." },
  editClosed: { code: "LIVE_CHAT_EDIT_CLOSED", message: "This message can no longer be edited." },
  replyClosed: { code: "LIVE_CHAT_NOT_ALLOWED", message: "That message can no longer be replied to." },
  tooShort: {
    code: "LIVE_CHAT_NOT_A_QUESTION",
    message: `A question needs at least ${LIVE_ROOM_POLICY.questionMinLength} characters.`,
  },
} satisfies Record<string, LiveRefusal>;

const ALLOWANCES = {
  reaction: LIVE_CHAT_POLICY.reactionsPerPerson,
  report: LIVE_CHAT_POLICY.reportsPerPerson,
  history: LIVE_CHAT_POLICY.historyRequestsPerPerson,
  author: LIVE_CHAT_POLICY.authorLookupsPerPerson,
  edit: LIVE_CHAT_POLICY.editsPerPerson,
} satisfies Record<Allowance, { limit: number; windowSeconds: number }>;

/** Who the room names when it holds a message after reports rather than on a moderator's decision. */
const HELD_BY = "Held after reports";

function staff(viewer: LiveRoomParticipant): boolean {
  return viewer.role === "operator";
}

/**
 * The chat's use cases: send or reply, edit, react, report, delete, remove or keep,
 * convert to a question and page back through history. Each request is
 * checked against the shared chat policy for this viewer and message; every
 * moderator action is audited; moderation data reaches moderators only.
 */
export class LiveRoomChatActions {
  /** Per-person sliding windows; a room woken from hibernation starts them afresh. */
  private readonly allowances = new Map<string, number[]>();
  private readonly reactionsDue = new Map<string, Set<string>>();
  private reactionTimer: ReturnType<typeof setTimeout> | null = null;
  /** The check that owns each message's verdict: the latest one started, so an older check never settles newer words. */
  private readonly checkRuns = new Map<string, number>();
  private lastCheckRun = 0;
  private tickerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly chat: LiveRoomChat,
    private readonly feed: LiveChatFeed,
    private readonly store: LiveRoomStore,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly authors: LiveRoomAuthors,
    private readonly checks: LiveRoomClassifiers,
    private readonly hooks: {
      /** Attendee chat changed; the chat list and ticker on air may show something else now. */
      onAirChanged: () => void;
      /** The session a message sent now is dated by, in a location's chat; null in a session's room. */
      stamp: () => string | null;
      checkWrite: (viewer: LiveRoomParticipant, occurrenceId: string | null) => Promise<LiveRefusal | null>;
      /** Asks a converted message in a session's room; answers the question's id or why it could not. */
      ask: (
        question: LiveChatQuestion,
        by: Actor,
        at: string,
        sentDuring: string | null,
      ) => Promise<string | LiveRefusal>;
      /** A moderator acted or a question was created; the durable copy, with its audit rows, is due. */
      audited: () => Promise<void>;
      /** An attendee message changed the chat counts; their durable copy is due. */
      counted: () => Promise<void>;
      /** The room paused someone on its own; they learn it, and moderators see it on their posts. */
      participationChanged: (userId: string) => Promise<void>;
    },
  ) {}

  async handle(viewer: LiveRoomParticipant, actor: Actor, command: ChatCommand, socket: WebSocket) {
    const restricted = this.feed.decisions.restriction(actor.userId, Date.now()) !== null;
    if (command.type === "chat.history") return this.history(viewer, actor, command.channel, command.before, socket);
    if (command.type === "chat.unpin") return staff(viewer) ? this.unpin(actor) : REFUSALS.notAllowed;
    if (command.type === "chat.send") {
      const answered = command.replyTo ? this.answerable(command.replyTo, viewer, restricted, command.channel) : null;
      if (answered && typeof answered !== "string") return answered;
      return this.send(viewer, actor, restricted, command.text, command.channel, answered, socket);
    }
    const row = this.visible(command.messageId, viewer);
    if (!row) return REFUSALS.missing;
    if (command.type === "chat.edit" || command.type === "chat.react" || command.type === "chat.report") {
      const refusal = await this.hooks.checkWrite(viewer, row.occurrence_id);
      if (refusal || socket.readyState !== WebSocket.OPEN) return refusal ?? REFUSALS.notAllowed;
      if (!this.visible(row.id, viewer)) return REFUSALS.missing;
    }
    const allowed = this.actionsOn(row, viewer, restricted);
    const refuse = (action: LiveChatAction) =>
      allowed.has(action)
        ? null
        : restricted && (action === "react" || action === "report")
          ? REFUSALS.blocked
          : action === "edit" && row.author_user_id === actor.userId
            ? REFUSALS.editClosed
            : REFUSALS.notAllowed;
    const at = nowIso();
    switch (command.type) {
      case "chat.edit":
        return refuse("edit") ?? this.edit(actor, row, command.text, at);
      case "chat.react":
        return refuse("react") ?? this.react(actor, row, command.reaction, command.on);
      case "chat.report":
        return refuse("report") ?? this.report(actor, row, command.reason, at);
      case "chat.delete":
        return refuse("delete") ?? this.remove(row);
      case "chat.moderate":
        return refuse(command.decision) ?? this.moderate(actor, row, command.decision, command.reason ?? null, at);
      case "chat.convert":
        return refuse("convert") ?? this.convert(actor, row, at);
      case "chat.pin":
        return refuse("pin") ?? this.pin(actor, row, at);
    }
  }

  /** A message a viewer may not see does not exist for them, whatever its id. */
  private visible(messageId: string, viewer: LiveRoomParticipant): LiveChatRow | null {
    const row = this.chat.message(messageId);
    return row && this.feed.batch([row], []).project(row, viewer) ? row : null;
  }

  /** The message a reply answers, when this viewer may answer it in this channel; else why not. */
  private answerable(
    messageId: string,
    viewer: LiveRoomParticipant,
    restricted: boolean,
    channel: LiveChatChannel = "attendee",
  ): string | LiveRefusal {
    const parent = this.visible(messageId, viewer);
    if (!parent || parent.channel !== channel) return REFUSALS.missing;
    return this.actionsOn(parent, viewer, restricted).has("reply") ? parent.id : REFUSALS.replyClosed;
  }

  private actionsOn(row: LiveChatRow, viewer: LiveRoomParticipant, restricted: boolean) {
    const hiding = this.feed.moderation.hidden([row.id]).get(row.id);
    const reports = this.feed.moderation.reportCount(row.id);
    const author = this.feed.people.people([row.author_user_id]).get(row.author_user_id);
    const converted = this.feed.moderation.questions([row.id]).has(row.id);
    return liveChatActions(liveChatCapacity(viewer), restricted, {
      channel: row.channel,
      mine: row.author_user_id === viewer.userId,
      hidden: hiding !== undefined,
      held: hiding?.held ?? false,
      reported: reports > 0,
      flaggedByCheck: this.feed.moderation.checks.flagged([row.id]).has(row.id),
      reportedByMe: Boolean(
        viewer.userId && this.feed.moderation.reportedBy([row.id], [viewer.userId]).get(viewer.userId)?.has(row.id),
      ),
      converted,
      done: this.feed.decisions.done([row.id]).has(row.id),
      authorStaff: author?.staff ?? false,
      authorRestriction: this.feed.decisions.restriction(row.author_user_id, Date.now())?.block ?? null,
      sentAt: row.sent_at,
      editLocked: reports > 0 || converted || this.chat.aired([row.id]).has(row.id),
      pinned: this.feed.moderation.pinned() === row.id,
    });
  }

  /** Records a moderation act for the audit log, which reaches D1 with the room's next durable copy. */
  private audit(actorUserId: string, action: string, details: Record<string, unknown>, at: string): void {
    this.store.recordStaffAction(actorUserId, action, details, at);
    this.ctx.waitUntil(this.hooks.audited());
  }

  private allowed(kind: Allowance, userId: string): boolean {
    const key = `${kind}:${userId}`;
    const history = this.allowances.get(key) ?? [];
    this.allowances.set(key, history);
    return takeLiveAllowance(history, Date.now(), ALLOWANCES[kind]);
  }

  private async send(
    viewer: LiveRoomParticipant,
    actor: Actor,
    restricted: boolean,
    text: string,
    channel: LiveChatChannel = "attendee",
    replyTo: string | null,
    socket: WebSocket,
  ) {
    if (!liveChatCanSend(liveChatCapacity(viewer), restricted, channel))
      return restricted ? REFUSALS.blocked : REFUSALS.notAllowed;
    const stamp = await this.authors.writing(viewer);
    const occurrenceId = this.hooks.stamp();
    const refusal = await this.hooks.checkWrite(viewer, occurrenceId);
    if (refusal || socket.readyState !== WebSocket.OPEN || this.hooks.stamp() !== occurrenceId)
      return refusal ?? REFUSALS.notAllowed;
    // Author resolution yields: a moderator may have blocked this person meanwhile.
    if (viewer.role !== "operator" && this.feed.decisions.restriction(actor.userId, Date.now()))
      return REFUSALS.blocked;
    const row = this.chat.send(actor, text, Date.now(), channel, occurrenceId, replyTo);
    if (!row) return REFUSALS.tooFast;
    this.authors.recordMessage(row.id, stamp);
    // Everyone in the attendee chat is checked, the people who run the session too.
    const run = channel === "attendee" ? this.markChecking(row) : null;
    await this.deliver([row], { removeWhenHidden: false });
    if (run !== null) this.check(row, run);
    if (channel !== "attendee") return;
    this.nudgeTicker();
    await this.hooks.counted();
  }

  /** The author's new words, to everyone as they may see them; the original stays with moderators. */
  private async edit(actor: Actor, row: LiveChatRow, text: string, at: string) {
    if (text === row.body) return;
    if (!this.allowed("edit", actor.userId)) return REFUSALS.tooFast;
    const edited = this.chat.edit(row, text, at);
    if (!edited) return;
    const run = edited.channel === "attendee" ? this.markChecking(edited) : null;
    await this.redeliver([edited]);
    if (run !== null) this.check(edited, run);
  }

  /**
   * Everyone reads an attendee's words at once; the classifier runs behind them. A blocked message is then
   * taken from everyone but its author and moderators, like one held after reports, and an author blocked again
   * and again is paused. An advised one stays in the chat, in the moderators' review queue. The on-air outputs
   * wait for the verdict and leave out a flagged message until a moderator keeps it.
   */
  private markChecking(row: LiveChatRow): number | null {
    // New words: whatever check is still running for the old ones no longer speaks for this message.
    this.checkRuns.delete(row.id);
    if (!this.checks.mayRun("chat")) return null;
    const run = ++this.lastCheckRun;
    this.checkRuns.set(row.id, run);
    this.feed.moderation.checks.pending(row.id, nowIso());
    // The outputs stop waiting once the wait is over, whether or not the check ever answers.
    setTimeout(() => this.hooks.onAirChanged(), LIVE_CHAT_CHECK_WAIT_MS + 1);
    return run;
  }

  /** Starts the check once everyone has the message, so its verdict always follows the message itself. */
  private check(row: LiveChatRow, run: number): void {
    const progress = { recorded: false };
    this.ctx.waitUntil(
      this.settleCheck(row, run, progress)
        .catch(async (error: unknown) => {
          console.error("Live chat check failed", error);
          // A check that fails leaves the message in the chat and stops the outputs waiting for it. A verdict it
          // already recorded stays for moderators; only its delivery is tried again.
          try {
            if (progress.recorded) await this.deliverChecked(row.id, run);
            else this.passCheck(row.id, run);
          } catch {
            /* The room is going away; the outputs stop waiting for the message by themselves. */
          }
        })
        .finally(() => {
          if (this.ownsCheck(row.id, run)) this.checkRuns.delete(row.id);
        }),
    );
  }

  /** Whether this check still owns the message's verdict: the message was neither deleted nor edited since. */
  private ownsCheck(messageId: string, run: number): boolean {
    return this.checkRuns.get(messageId) === run && this.chat.message(messageId) !== null;
  }

  /** The examined words passed, or could not be checked: the outputs no longer wait for them. */
  private passCheck(messageId: string, run: number): void {
    if (!this.ownsCheck(messageId, run)) return;
    this.feed.moderation.checks.clear(messageId);
    this.nudgeTicker();
  }

  /** Delivers the examined words again with the verdict they keep, unless they were deleted or edited since. */
  private async deliverChecked(messageId: string, run: number): Promise<void> {
    const row = this.chat.message(messageId);
    if (!row || !this.ownsCheck(messageId, run)) return;
    await this.deliver([row], { removeWhenHidden: this.feed.moderation.hidden([row.id]).has(row.id) });
    this.nudgeTicker();
  }

  private async settleCheck(sent: LiveChatRow, run: number, progress: { recorded: boolean }): Promise<void> {
    const result = await this.checks.run("chat", liveChatPlainText(sent.body));
    const row = this.chat.message(sent.id);
    // Deleted, or edited again meanwhile: the newer words have a check of their own.
    if (!row || !this.ownsCheck(row.id, run)) return;
    const at = nowIso();
    if (result) this.feed.moderation.checks.keepResult(row.id, liveCheckResult(result), at);
    const outcome = result?.verdict.outcome;
    if (outcome !== "advised" && outcome !== "blocked") return this.passCheck(row.id, run);
    this.feed.moderation.checks.record(
      row.id,
      outcome,
      result!.verdict.flags.map((flag) => flag.message),
      at,
    );
    progress.recorded = true;
    const removes = outcome === "blocked" && !this.feed.moderation.hidden([row.id]).has(row.id);
    if (removes) this.feed.moderation.hide(row.id, LIVE_CHAT_HELD_BY_CHECK, true, at);
    // Every blocked verdict counts towards a pause, whether or not the message was already hidden.
    if (outcome === "blocked") await this.pauseAfterRepeatedBlocks(row.author_user_id, at);
    if (removes) await this.deliver([row], { removeWhenHidden: true });
    else await this.deliver([row], { removeWhenHidden: false, only: staff });
    this.nudgeTicker();
  }

  /**
   * Pauses an author whose messages the check keeps blocking, so a moderator decides whether they go on. A person
   * already paused or blocked keeps that decision.
   */
  private async pauseAfterRepeatedBlocks(userId: string, at: string): Promise<void> {
    const { blocks, windowMinutes } = LIVE_CHAT_POLICY.checkPause;
    const since = new Date(Date.parse(at) - windowMinutes * 60_000).toISOString();
    if (this.feed.moderation.checks.blockedSince(userId, since) < blocks) return;
    // A pause does not reach the people who run the session; their blocked messages stay hidden all the same.
    if (this.feed.people.people([userId]).get(userId)?.staff) return;
    if (this.feed.decisions.restriction(userId, Date.now())) return;
    this.feed.decisions.block(userId, "paused", "conduct", { userId: "", name: LIVE_CHAT_HELD_BY_CHECK }, at);
    await this.hooks.participationChanged(userId);
  }

  private react(actor: Actor, row: LiveChatRow, reaction: LiveChatReactionId, on: boolean) {
    if (!this.allowed("reaction", actor.userId)) return REFUSALS.tooFast;
    if (!this.feed.reactions.set(row.id, actor.userId, reaction, on)) return;
    this.reactionsDue.set(row.id, (this.reactionsDue.get(row.id) ?? new Set()).add(actor.userId));
    this.reactionTimer ??= setTimeout(
      () => this.ctx.waitUntil(this.flushReactions()),
      LIVE_CHAT_POLICY.reactionBroadcastMilliseconds,
    );
  }

  /** Counts go out together: one shared payload per message, and their own reactions to those who changed them. */
  async flushReactions(): Promise<void> {
    const due = [...this.reactionsDue];
    this.reactionsDue.clear();
    this.reactionTimer = null;
    for (const [messageId, changed] of due) {
      const row = this.chat.message(messageId);
      if (!row) continue;
      const hidden = this.feed.moderation.hidden([row.id]).has(row.id);
      const reactions = this.feed.reactions.counts([row.id]).get(row.id) ?? {};
      const mine = this.feed.reactions.mine([row.id], [...changed]);
      await this.broadcast.send(
        (viewer) =>
          liveChatChannelVisible(row.channel, viewer) &&
          seesChatOccurrence(viewer, row.occurrence_id) &&
          (!hidden || staff(viewer))
            ? {
                type: "chat.reactions",
                channel: row.channel,
                messageId: row.id,
                reactions,
                myReactions:
                  viewer.userId && changed.has(viewer.userId) ? (mine.get(viewer.userId)?.get(row.id) ?? []) : null,
              }
            : null,
        (viewer) =>
          JSON.stringify([chatAudienceKey(viewer), viewer.userId && changed.has(viewer.userId) ? viewer.userId : null]),
      );
    }
  }

  private async report(actor: Actor, row: LiveChatRow, reason: LiveModerationReason, at: string) {
    if (!this.allowed("report", actor.userId)) return REFUSALS.tooFast;
    if (!this.feed.moderation.report(row.id, actor.userId, reason, at)) return;
    const hiding = this.feed.moderation.hidden([row.id]).get(row.id);
    if (!hiding && this.feed.moderation.reportCount(row.id) >= LIVE_CHAT_POLICY.reportHoldThreshold) {
      this.feed.moderation.hide(row.id, HELD_BY, true, at);
      this.audit(
        actor.userId,
        "live_session.chat.held",
        { messageId: row.id, reports: this.feed.moderation.reportCount(row.id) },
        at,
      );
      await this.deliver([row], { removeWhenHidden: true });
      this.nudgeTicker();
      return;
    }
    // Moderators see the report; the reporter sees their own report; nobody else learns of it.
    await this.deliver([row], {
      removeWhenHidden: false,
      only: (viewer) => staff(viewer) || viewer.userId === actor.userId,
    });
    this.nudgeTicker();
  }

  private async remove(row: LiveChatRow) {
    this.chat.remove([row.id]);
    await this.broadcast.chatRemoved(row);
    if (row.channel === "attendee") this.nudgeTicker();
  }

  private async moderate(
    actor: Actor,
    row: LiveChatRow,
    decision: "remove" | "keep",
    reason: LiveModerationReason | null,
    at: string,
  ) {
    if (decision === "remove" && reason) this.removeWithReason(actor, row, reason, at);
    else {
      this.feed.moderation.keep(row.id, at);
      this.feed.decisions.restore(row.id);
    }
    this.audit(
      actor.userId,
      decision === "remove" ? "live_session.chat.removed" : "live_session.chat.kept",
      { messageId: row.id, channel: row.channel, ...(decision === "remove" ? { reason } : {}) },
      at,
    );
    await this.redeliver([row]);
  }

  /** Takes a message from everyone but its author and moderators, recording why. */
  removeWithReason(actor: Actor, row: LiveChatRow, reason: LiveModerationReason, at: string): void {
    this.feed.moderation.hide(row.id, actor.name, false, at);
    this.feed.decisions.remove("chat", row.id, reason, actor, at);
  }

  /** Sends changed messages to everyone as they may see them now, and their removal to those who no longer may. */
  async redeliver(rows: LiveChatRow[]): Promise<void> {
    if (!rows.length) return;
    await this.deliver(rows, { removeWhenHidden: true });
    if (rows.some((row) => row.channel === "attendee")) this.nudgeTicker();
  }

  private async convert(actor: Actor, row: LiveChatRow, at: string) {
    const text = liveChatPlainText(row.body);
    if (text.length < LIVE_ROOM_POLICY.questionMinLength) return REFUSALS.tooShort;
    const asked = await this.hooks.ask(
      {
        authorUserId: row.author_user_id,
        authorName: row.author_name,
        body:
          text.length > LIVE_ROOM_POLICY.questionMaxLength
            ? `${text.slice(0, LIVE_ROOM_POLICY.questionMaxLength - 1).trimEnd()}…`
            : text,
        askedAt: row.sent_at,
        // The question keeps the photo the author had when they wrote in the chat.
        authorPhotoUrl: this.feed.people.people([row.author_user_id]).get(row.author_user_id)?.photoUrl ?? null,
        stamp: this.authors.messageStamps([row.id]).get(row.id) ?? null,
      },
      actor,
      at,
      row.occurrence_id ?? null,
    );
    if (typeof asked !== "string") return asked;
    this.feed.moderation.linkQuestion(row.id, asked);
    this.audit(actor.userId, "live_session.chat.converted", { messageId: row.id, questionId: asked }, at);
    await this.deliver([row], { removeWhenHidden: false, only: staff });
  }

  /** Puts a message on top of the chat for everyone who sees it, in place of the one pinned before. */
  private async pin(actor: Actor, row: LiveChatRow, at: string) {
    this.feed.moderation.pin(row.id, actor.name, at);
    this.audit(actor.userId, "live_session.chat.pinned", { messageId: row.id }, at);
    await this.sendPinned();
  }

  private async unpin(actor: Actor) {
    const pinned = this.feed.moderation.pinned();
    if (!pinned) return;
    this.feed.moderation.unpin();
    this.audit(actor.userId, "live_session.chat.unpinned", { messageId: pinned }, nowIso());
    await this.sendPinned();
  }

  /** The pinned message to everyone as they may see it; its author's copy is their own. */
  private async sendPinned(): Promise<void> {
    const id = this.feed.moderation.pinned();
    const row = id ? this.chat.message(id) : null;
    const batch = row
      ? this.feed.batch([row], this.connectedPeople(), await this.feed.moderatorRestrictions([row]))
      : null;
    await this.broadcast.send(
      (viewer) =>
        liveChatChannelVisible("attendee", viewer)
          ? { type: "chat.pinned", message: row && batch ? batch.project(row, viewer) : null }
          : null,
      (viewer) => JSON.stringify([chatAudienceKey(viewer), row && batch?.personal(row, viewer) ? viewer.userId : null]),
    );
  }

  /** One author's card, to the asking socket only, when the handle names someone they can see writing here. */
  async lookupAuthor(viewer: LiveRoomParticipant, actor: Actor, handle: string, socket: WebSocket) {
    if (!this.allowed("author", actor.userId)) return REFUSALS.tooFast;
    const author = await this.authors.lookup(viewer, handle);
    socket.send(serializeLiveRoomMessage({ type: "author.details", handle, author }));
  }

  private async history(
    viewer: LiveRoomParticipant,
    actor: Actor,
    channel: LiveChatChannel,
    before: string | null,
    socket: WebSocket,
  ) {
    if (!this.allowed("history", actor.userId)) return REFUSALS.tooFast;
    if (!liveChatChannelVisible(channel, viewer)) return REFUSALS.notAllowed;
    const page = await this.feed.history(viewer, channel, before);
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!page) return REFUSALS.missing;
    socket.send(serializeLiveRoomMessage({ type: "chat.history", channel, ...page }));
  }

  /**
   * Sends each viewer the messages as they may see them now. A viewer who may
   * no longer see one receives its removal when `removeWhenHidden`.
   */
  private async deliver(
    rows: LiveChatRow[],
    options: { removeWhenHidden: boolean; only?: (viewer: LiveRoomParticipant) => boolean },
  ): Promise<void> {
    const people = this.connectedPeople();
    const restrictions = this.ctx.getWebSockets("operator").length
      ? await this.feed.moderatorRestrictions(rows)
      : undefined;
    for (const row of rows) {
      const batch = this.feed.batch([row], people, restrictions);
      await this.broadcast.send(
        (viewer) => {
          if (options.only && !options.only(viewer)) return null;
          const message = batch.project(row, viewer);
          if (message) return { type: "chat.message", message } satisfies LiveRoomServerMessage;
          return options.removeWhenHidden &&
            liveChatChannelVisible(row.channel, viewer) &&
            seesChatOccurrence(viewer, row.occurrence_id)
            ? { type: "chat.removed", messageId: row.id, channel: row.channel, moderated: true }
            : null;
        },
        // A copy with something of the viewer's own is theirs alone; every other copy is shared by its audience.
        (viewer) =>
          JSON.stringify([
            chatAudienceKey(viewer),
            batch.personal(row, viewer) ? viewer.userId : null,
            options.only?.(viewer) ?? true,
          ]),
      );
    }
  }

  private connectedPeople(): string[] {
    return [
      ...new Set(
        this.ctx
          .getWebSockets()
          .flatMap((socket) => (socket.deserializeAttachment() as LiveRoomParticipant | null)?.userId ?? []),
      ),
    ];
  }

  private nudgeTicker(): void {
    this.hooks.onAirChanged();
    // Asked again once the ticker's refresh interval has passed, so a change in the meantime shows too.
    this.tickerTimer ??= setTimeout(() => {
      this.tickerTimer = null;
      this.hooks.onAirChanged();
    }, LIVE_CHAT_POLICY.tickerRefreshMilliseconds);
  }
}
