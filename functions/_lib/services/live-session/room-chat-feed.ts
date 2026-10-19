import { LIVE_CHAT_POLICY } from "../../../../assets/shared/live-chat-policy";
import { publicSessionPortraitUrlSchema } from "../../../../assets/shared/schemas/event-session-history";
import type { LiveChatChannel, LiveChatMessage } from "../../../../assets/shared/schemas/live-session-chat";
import type { DatabaseLike } from "../../types";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomChat, LiveChatRemoval, LiveChatRow } from "./room-chat";
import type { LiveChatModerationStore } from "./room-chat-moderation";
import type { LiveChatReactionStore } from "./room-chat-reactions";
import type { LiveRoomAuthors } from "./room-authors";

/** Moderators see every message with its moderation; everyone else sees what is shown. */
function staff(viewer: LiveRoomParticipant): boolean {
  return viewer.role === "operator";
}

/** Whether a viewer receives a channel at all; banned people receive no chat. */
export function liveChatChannelVisible(
  channel: LiveChatChannel,
  viewer: LiveRoomParticipant,
  banned: ReadonlySet<string>,
): boolean {
  if (viewer.role === "overlay" || (viewer.userId !== null && banned.has(viewer.userId))) return false;
  return channel === "attendee" || staff(viewer);
}

function photo(value: string | null | undefined): string | null {
  return value && publicSessionPortraitUrlSchema.safeParse(value).success ? value : null;
}

/**
 * Some messages read once, ready to project for any number of viewers. The
 * room-wide parts (counts, moderation, authors) are read together; each
 * viewer's own reactions and reports are read for the people named.
 */
export interface LiveChatBatch {
  rows: LiveChatRow[];
  banned: ReadonlySet<string>;
  /** The message as this viewer may see it, or null when they may not. */
  project(row: LiveChatRow, viewer: LiveRoomParticipant): LiveChatMessage | null;
  /** Whether a viewer's copy carries something of their own: authorship, reactions or a report. */
  personal(row: LiveChatRow, viewer: LiveRoomParticipant): boolean;
}

/** The chat as each viewer may see it: pages, single messages, the report queue and removals. */
export class LiveChatFeed {
  constructor(
    private readonly chat: LiveRoomChat,
    readonly moderation: LiveChatModerationStore,
    readonly reactions: LiveChatReactionStore,
    readonly authors: LiveRoomAuthors,
  ) {}

  get people() {
    return this.authors.people;
  }

  batch(rows: LiveChatRow[], viewers: readonly string[]): LiveChatBatch {
    const ids = rows.map((row) => row.id);
    const authors = rows.map((row) => row.author_user_id);
    const counts = this.reactions.counts(ids);
    const mine = this.reactions.mine(ids, viewers);
    const reports = this.moderation.reports(ids);
    const reportedBy = this.moderation.reportedBy(ids, viewers);
    const hidden = this.moderation.hidden(ids);
    const questions = this.moderation.questions(ids);
    const restrictions = this.moderation.restrictions(authors);
    const people = this.people.people(authors);
    const stamps = this.authors.messageStamps(ids);
    const banned = this.moderation.banned();
    return {
      rows,
      banned,
      personal: (row, viewer) =>
        viewer.userId !== null &&
        (row.author_user_id === viewer.userId ||
          Boolean(mine.get(viewer.userId)?.has(row.id)) ||
          Boolean(reportedBy.get(viewer.userId)?.has(row.id))),
      project: (row, viewer) => {
        if (!liveChatChannelVisible(row.channel, viewer, banned)) return null;
        const hiding = hidden.get(row.id) ?? null;
        if ((hiding || banned.has(row.author_user_id)) && !staff(viewer)) return null;
        const report = reports.get(row.id);
        const author = people.get(row.author_user_id);
        return {
          channel: row.channel,
          id: row.id,
          text: row.body,
          authorName: row.author_name,
          authorPhotoUrl: photo(author?.photoUrl),
          authorHandle: author?.handle ?? null,
          authorAffiliation: stamps.get(row.id)?.affiliation ?? null,
          authorRoles: stamps.get(row.id)?.roles ?? [],
          mine: viewer.userId === row.author_user_id,
          sentAt: row.sent_at,
          reactions: counts.get(row.id) ?? {},
          myReactions: (viewer.userId && mine.get(viewer.userId)?.get(row.id)) || [],
          reportedByMe: Boolean(viewer.userId && reportedBy.get(viewer.userId)?.has(row.id)),
          moderation: staff(viewer)
            ? {
                hidden: hiding ? { operatorName: hiding.by_name, at: hiding.at } : null,
                held: hiding?.held ?? false,
                reports: report?.count ?? 0,
                reportReasons: report?.reasons ?? {},
                questionId: questions.get(row.id) ?? null,
                authorStaff: author?.staff ?? false,
                authorRestriction: restrictions.get(row.author_user_id) ?? null,
              }
            : null,
        };
      },
    };
  }

  /** What a viewer receives on joining: each channel's latest page, and the open reports for moderators. */
  snapshot(viewer: LiveRoomParticipant) {
    const viewers = viewer.userId ? [viewer.userId] : [];
    const chat: LiveChatMessage[] = [];
    const chatEarlier: Partial<Record<LiveChatChannel, boolean>> = {};
    for (const channel of ["attendee", "operator"] as const) {
      const page = this.chat.page(channel, {
        before: null,
        limit: LIVE_CHAT_POLICY.snapshotMessages,
        shownOnly: !staff(viewer),
      });
      const batch = this.batch(page.rows, viewers);
      const messages = page.rows.flatMap((row) => batch.project(row, viewer) ?? []);
      chat.push(...messages);
      if (messages.length) chatEarlier[channel] = page.hasEarlier;
    }
    const reportRows = staff(viewer)
      ? this.chat.messages(this.moderation.openReports(LIVE_CHAT_POLICY.reportQueueLimit))
      : [];
    const reports = this.batch(reportRows, viewers);
    return {
      chat,
      chatEarlier,
      chatReports: reportRows.flatMap((row) => reports.project(row, viewer) ?? []),
    };
  }

  /** The page before a message this viewer holds, or the latest page. */
  history(viewer: LiveRoomParticipant, channel: LiveChatChannel, beforeId: string | null) {
    const before = beforeId ? this.chat.message(beforeId) : null;
    if (beforeId && (!before || before.channel !== channel)) return null;
    const page = this.chat.page(channel, { before, limit: LIVE_CHAT_POLICY.historyPage, shownOnly: !staff(viewer) });
    const batch = this.batch(page.rows, viewer.userId ? [viewer.userId] : []);
    return {
      messages: page.rows.flatMap((row) => batch.project(row, viewer) ?? []),
      hasEarlier: page.hasEarlier,
    };
  }

  async eraseAnonymizedAuthors(db: DatabaseLike): Promise<LiveChatRemoval[]> {
    return this.chat.eraseAnonymizedAuthors(db);
  }

  banned(): ReadonlySet<string> {
    return this.moderation.banned();
  }
}
