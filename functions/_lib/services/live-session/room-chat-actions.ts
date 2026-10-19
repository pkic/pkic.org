import {
  LIVE_CHAT_POLICY,
  liveChatActions,
  liveChatCanSend,
  liveChatCapacity,
  liveChatPlainText,
  type LiveChatAction,
  type LiveChatReactionId,
  type LiveChatRestriction,
} from "../../../../assets/shared/live-chat-policy";
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

type ChatCommand = Extract<LiveRoomClientMessage, { type: `chat.${string}` }>;
type Actor = { userId: string; name: string };
type Allowance = "reaction" | "report" | "history" | "author";

const REFUSALS = {
  missing: { code: "LIVE_CHAT_MESSAGE_NOT_FOUND", message: "That message is no longer available." },
  notAllowed: { code: "LIVE_CHAT_NOT_ALLOWED", message: "You can't do that with this message." },
  muted: { code: "LIVE_CHAT_MUTED", message: "An organizer muted you in this chat. You can still read it." },
  banned: { code: "LIVE_CHAT_BANNED", message: "An organizer removed you from this chat." },
  tooFast: { code: "LIVE_CHAT_RATE_LIMITED", message: "Wait a moment before sending another chat message." },
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
} satisfies Record<Allowance, { limit: number; windowSeconds: number }>;

/** Who the room names when it holds a message after reports rather than on a moderator's decision. */
const HELD_BY = "Held after reports";

function staff(viewer: LiveRoomParticipant): boolean {
  return viewer.role === "operator";
}

/**
 * The chat's use cases: send, react, report, delete, moderate, restrict,
 * convert to a question and page back through history. Each request is
 * checked against the shared chat policy for this viewer and message; every
 * moderator action is audited; moderation data reaches moderators only.
 */
export class LiveRoomChatActions {
  /** Per-person sliding windows; a room woken from hibernation starts them afresh. */
  private readonly allowances = new Map<string, number[]>();
  private readonly reactionsDue = new Map<string, Set<string>>();
  private reactionTimer: ReturnType<typeof setTimeout> | null = null;
  private tickerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly chat: LiveRoomChat,
    private readonly feed: LiveChatFeed,
    private readonly store: LiveRoomStore,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly authors: LiveRoomAuthors,
    private readonly hooks: {
      /** Attendee chat changed; a chat ticker may show something else now. */
      tickerChanged: () => Promise<void>;
      /** A moderator acted or a question was created; the durable copy, with its audit rows, is due. */
      audited: () => Promise<void>;
    },
  ) {}

  async handle(viewer: LiveRoomParticipant, actor: Actor, command: ChatCommand, socket: WebSocket) {
    const restriction = this.feed.moderation.restriction(actor.userId);
    if (command.type === "chat.history") return this.history(viewer, actor, command.channel, command.before, socket);
    if (command.type === "chat.send") return this.send(viewer, actor, restriction, command.text, command.channel);
    const row = this.chat.message(command.messageId);
    if (restriction === "banned") return REFUSALS.banned;
    // A message a viewer may not see does not exist for them, whatever its id.
    if (!row || !this.feed.batch([row], []).project(row, viewer)) return REFUSALS.missing;
    const allowed = this.actionsOn(row, viewer, restriction);
    const refuse = (action: LiveChatAction) =>
      allowed.has(action)
        ? null
        : restriction === "muted" && (action === "react" || action === "report")
          ? REFUSALS.muted
          : REFUSALS.notAllowed;
    const at = nowIso();
    switch (command.type) {
      case "chat.react":
        return refuse("react") ?? this.react(actor, row, command.reaction, command.on);
      case "chat.report":
        return refuse("report") ?? this.report(actor, row, command.reason, at);
      case "chat.delete":
        return refuse("delete") ?? this.remove(row);
      case "chat.moderate":
        return refuse(command.decision) ?? this.moderate(actor, row, command.decision, at);
      case "chat.restrict": {
        const action = command.restriction === null ? "lift" : command.restriction === "muted" ? "mute" : "ban";
        return refuse(action) ?? this.restrict(actor, row, command.restriction, at);
      }
      case "chat.convert":
        return refuse("convert") ?? this.convert(actor, row, at);
    }
  }

  private actionsOn(row: LiveChatRow, viewer: LiveRoomParticipant, restriction: LiveChatRestriction | null) {
    const hiding = this.feed.moderation.hidden([row.id]).get(row.id);
    const reports = this.feed.moderation.reportCount(row.id);
    const author = this.feed.people.people([row.author_user_id]).get(row.author_user_id);
    return liveChatActions(liveChatCapacity(viewer), restriction, {
      channel: row.channel,
      mine: row.author_user_id === viewer.userId,
      hidden: hiding !== undefined,
      held: hiding?.held ?? false,
      reported: reports > 0,
      reportedByMe: Boolean(
        viewer.userId && this.feed.moderation.reportedBy([row.id], [viewer.userId]).get(viewer.userId)?.has(row.id),
      ),
      converted: this.feed.moderation.questions([row.id]).has(row.id),
      authorStaff: author?.staff ?? false,
      authorRestriction: this.feed.moderation.restriction(row.author_user_id),
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
    restriction: LiveChatRestriction | null,
    text: string,
    channel: LiveChatChannel = "attendee",
  ) {
    if (!liveChatCanSend(liveChatCapacity(viewer), restriction, channel))
      return restriction === "banned"
        ? REFUSALS.banned
        : restriction === "muted"
          ? REFUSALS.muted
          : REFUSALS.notAllowed;
    const stamp = await this.authors.writing(viewer);
    const row = this.chat.send(actor, text, Date.now(), channel);
    if (!row) return REFUSALS.tooFast;
    this.authors.recordMessage(row.id, stamp);
    await this.deliver([row], { removeWhenHidden: false });
    if (channel === "attendee") this.nudgeTicker();
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
      const banned = this.feed.banned();
      await this.broadcast.send(
        (viewer) =>
          liveChatChannelVisible(row.channel, viewer, banned) && (!hidden || staff(viewer))
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
          viewer.userId && changed.has(viewer.userId)
            ? `person:${viewer.userId}`
            : `${viewer.role}:${viewer.userId !== null && banned.has(viewer.userId)}`,
      );
    }
  }

  private async report(actor: Actor, row: LiveChatRow, reason: "abuse" | "conduct" | "spam" | "other", at: string) {
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
    await this.broadcast.all({ type: "chat.removed", messageId: row.id, channel: row.channel });
    if (row.channel === "attendee") this.nudgeTicker();
  }

  private async moderate(actor: Actor, row: LiveChatRow, decision: "hide" | "keep", at: string) {
    if (decision === "hide") this.feed.moderation.hide(row.id, actor.name, false, at);
    else this.feed.moderation.keep(row.id);
    this.audit(
      actor.userId,
      decision === "hide" ? "live_session.chat.hidden" : "live_session.chat.kept",
      { messageId: row.id, channel: row.channel },
      at,
    );
    await this.deliver([row], { removeWhenHidden: true });
    if (row.channel === "attendee") this.nudgeTicker();
  }

  private async restrict(actor: Actor, row: LiveChatRow, restriction: LiveChatRestriction | null, at: string) {
    const author = row.author_user_id;
    this.feed.moderation.restrict(author, restriction, actor.name, at);
    this.audit(
      actor.userId,
      "live_session.chat.restricted",
      { messageId: row.id, restriction: restriction ?? "lifted" },
      at,
    );
    // A ban takes the person's messages out of everyone's chat until it is lifted; moderators keep seeing them.
    const theirs = this.chat.byAuthor(author, LIVE_CHAT_POLICY.historyPage);
    await this.deliver(theirs.length ? theirs : [row], { removeWhenHidden: true });
    await this.broadcast.send(
      (viewer) => (viewer.userId === author ? { type: "chat.access", restriction } : null),
      () => "author",
    );
    this.nudgeTicker();
  }

  private async convert(actor: Actor, row: LiveChatRow, at: string) {
    const text = liveChatPlainText(row.body);
    if (text.length < LIVE_ROOM_POLICY.questionMinLength) return REFUSALS.tooShort;
    const questionId = crypto.randomUUID();
    this.store.addQuestion({
      id: questionId,
      authorUserId: row.author_user_id,
      authorName: row.author_name,
      anonymous: false,
      body:
        text.length > LIVE_ROOM_POLICY.questionMaxLength
          ? `${text.slice(0, LIVE_ROOM_POLICY.questionMaxLength - 1).trimEnd()}…`
          : text,
      askedAt: row.sent_at,
      // The question keeps the photo the author had when they wrote in the chat.
      authorPhotoUrl: this.feed.people.people([row.author_user_id]).get(row.author_user_id)?.photoUrl ?? null,
    });
    this.store.moderate(questionId, "approved", actor, at);
    const stamp = this.authors.messageStamps([row.id]).get(row.id);
    if (stamp) this.authors.recordQuestion(questionId, stamp);
    this.feed.moderation.linkQuestion(row.id, questionId);
    this.audit(actor.userId, "live_session.chat.converted", { messageId: row.id, questionId }, at);
    await this.broadcast.question(questionId);
    await this.deliver([row], { removeWhenHidden: false, only: staff });
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
    if (!liveChatChannelVisible(channel, viewer, this.feed.banned()))
      return this.feed.moderation.restriction(actor.userId) === "banned" ? REFUSALS.banned : REFUSALS.notAllowed;
    const page = this.feed.history(viewer, channel, before);
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
    const people = [
      ...new Set(
        this.ctx
          .getWebSockets()
          .flatMap((socket) => (socket.deserializeAttachment() as LiveRoomParticipant | null)?.userId ?? []),
      ),
    ];
    for (const row of rows) {
      const batch = this.feed.batch([row], people);
      await this.broadcast.send(
        (viewer) => {
          if (options.only && !options.only(viewer)) return null;
          const message = batch.project(row, viewer);
          if (message) return { type: "chat.message", message } satisfies LiveRoomServerMessage;
          return options.removeWhenHidden && liveChatChannelVisible(row.channel, viewer, batch.banned)
            ? { type: "chat.removed", messageId: row.id, channel: row.channel }
            : null;
        },
        // A copy with something of the viewer's own is theirs alone; every other copy is shared by its audience.
        (viewer) =>
          batch.personal(row, viewer)
            ? `person:${viewer.userId}`
            : `${viewer.role}:${viewer.userId !== null && batch.banned.has(viewer.userId)}:${options.only?.(viewer) ?? true}`,
      );
    }
  }

  private nudgeTicker(): void {
    this.tickerTimer ??= setTimeout(() => {
      this.tickerTimer = null;
      this.ctx.waitUntil(this.hooks.tickerChanged());
    }, LIVE_CHAT_POLICY.tickerRefreshMilliseconds);
  }
}
