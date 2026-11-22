import { LIVE_CHAT_POLICY, liveChatReplyExcerpt } from "../../../../assets/shared/live-chat-policy";
import { publicSessionPortraitUrlSchema } from "../../../../assets/shared/schemas/event-session-history";
import type {
  LiveChatChannel,
  LiveChatMessage,
  LiveChatReplyQuote,
} from "../../../../assets/shared/schemas/live-session-chat";
import type { LiveParticipationRestriction } from "../../../../assets/shared/live-moderation-policy";
import type { DatabaseLike } from "../../types";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomChat, LiveChatRemoval, LiveChatRow } from "./room-chat";
import type { LiveChatModerationStore } from "./room-chat-moderation";
import type { LiveChatReactionStore } from "./room-chat-reactions";
import type { LiveRoomAuthors } from "./room-authors";
import type { LiveRoomModerationStore } from "./room-moderation-store";
import { chatOccurrenceIds, seesChatOccurrence } from "./room-chat-audience";

/** Moderators see every message with its moderation; everyone else sees what is shown. */
function staff(viewer: LiveRoomParticipant): boolean {
  return viewer.role === "operator";
}

/** Whether a viewer receives a channel at all. A blocked person keeps reading the chat. */
export function liveChatChannelVisible(channel: LiveChatChannel, viewer: LiveRoomParticipant): boolean {
  if (viewer.role === "overlay") return false;
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
  /** The message as this viewer may see it, or null when they may not. */
  project(row: LiveChatRow, viewer: LiveRoomParticipant): LiveChatMessage | null;
  /** Whether a viewer's copy carries something of their own: authorship, reactions, a report or a reply to them. */
  personal(row: LiveChatRow, viewer: LiveRoomParticipant): boolean;
}

/** The chat as each viewer may see it: pages, single messages, the report queue and removals. */
export class LiveChatFeed {
  constructor(
    private readonly chat: LiveRoomChat,
    readonly moderation: LiveChatModerationStore,
    readonly reactions: LiveChatReactionStore,
    readonly authors: LiveRoomAuthors,
    readonly decisions: LiveRoomModerationStore,
    private readonly occurrenceRestrictions: (
      occurrenceId: string | null,
      userIds: string[],
    ) => Promise<Record<string, LiveParticipationRestriction>> | undefined,
  ) {}

  get people() {
    return this.authors.people;
  }

  async moderatorRestrictions(rows: LiveChatRow[]) {
    const authors = new Map<string | null, Set<string>>();
    for (const row of rows) {
      const group = authors.get(row.occurrence_id) ?? new Set<string>();
      group.add(row.author_user_id);
      authors.set(row.occurrence_id, group);
    }
    return new Map(
      await Promise.all(
        [...authors].map(
          async ([occurrenceId, userIds]) =>
            [occurrenceId, await this.occurrenceRestrictions(occurrenceId, [...userIds])] as const,
        ),
      ),
    );
  }

  batch(
    rows: LiveChatRow[],
    viewers: readonly string[],
    occurrenceRestrictions?: Awaited<ReturnType<LiveChatFeed["moderatorRestrictions"]>>,
  ): LiveChatBatch {
    const ids = rows.map((row) => row.id);
    const authors = rows.map((row) => row.author_user_id);
    const counts = this.reactions.counts(ids);
    const mine = this.reactions.mine(ids, viewers);
    const reports = this.moderation.reports(ids);
    const reportedBy = this.moderation.reportedBy(ids, viewers);
    const hidden = this.moderation.hidden(ids);
    const questions = this.moderation.questions(ids);
    const restrictions = this.decisions.restrictions(authors, Date.now());
    const removals = this.decisions.removals(ids);
    const done = this.decisions.done(ids);
    const people = this.people.people(authors);
    const stamps = this.authors.messageStamps(ids);
    const originals = this.chat.originals(ids);
    const aired = this.chat.aired(ids);
    const parentIds = [...new Set(rows.flatMap((row) => row.reply_to ?? []))];
    const parents = new Map(this.chat.messages(parentIds).map((row) => [row.id, row]));
    const parentsHidden = this.moderation.hidden(parentIds);
    /** The answered message as this viewer sees it: removed once deleted, or hidden from everyone but moderators. */
    const quote = (row: LiveChatRow, viewer: LiveRoomParticipant): LiveChatReplyQuote | null => {
      if (!row.reply_to) return null;
      const parent = parents.get(row.reply_to);
      if (!parent || !seesChatOccurrence(viewer, parent.occurrence_id)) return null;
      const shown = parent.channel === row.channel && (!parentsHidden.has(parent.id) || staff(viewer));
      return {
        messageId: row.reply_to,
        authorName: shown ? parent.author_name : null,
        excerpt: shown ? liveChatReplyExcerpt(parent.body) : null,
        mine: shown && viewer.userId !== null && parent.author_user_id === viewer.userId,
      };
    };
    return {
      rows,
      personal: (row, viewer) =>
        viewer.userId !== null &&
        (row.author_user_id === viewer.userId ||
          Boolean(mine.get(viewer.userId)?.has(row.id)) ||
          Boolean(reportedBy.get(viewer.userId)?.has(row.id)) ||
          (row.reply_to !== null && parents.get(row.reply_to)?.author_user_id === viewer.userId)),
      project: (row, viewer) => {
        if (!liveChatChannelVisible(row.channel, viewer) || !seesChatOccurrence(viewer, row.occurrence_id)) return null;
        const hiding = hidden.get(row.id) ?? null;
        const mineRow = viewer.userId === row.author_user_id;
        const removal = removals.get(row.id) ?? null;
        const doneRow = done.get(row.id);
        // The author keeps seeing a message a moderator removed, with the reason; a held one stays theirs too.
        if (hiding && !staff(viewer) && !mineRow) return null;
        const report = reports.get(row.id);
        const author = people.get(row.author_user_id);
        const replyTo = quote(row, viewer);
        const original = originals.get(row.id);
        return {
          channel: row.channel,
          id: row.id,
          text: row.body,
          authorName: row.author_name,
          authorPhotoUrl: photo(author?.photoUrl),
          authorHandle: author?.handle ?? null,
          authorAffiliation: stamps.get(row.id)?.affiliation ?? null,
          authorRoles: stamps.get(row.id)?.roles ?? [],
          mine: mineRow,
          sentAt: row.sent_at,
          ...(row.edited_at ? { editedAt: row.edited_at } : {}),
          ...(mineRow ? { editLocked: Boolean(report?.count) || questions.has(row.id) || aired.has(row.id) } : {}),
          ...(replyTo ? { replyTo } : {}),
          ...(row.occurrence_id ? { occurrenceId: row.occurrence_id } : {}),
          reactions: counts.get(row.id) ?? {},
          myReactions: (viewer.userId && mine.get(viewer.userId)?.get(row.id)) || [],
          reportedByMe: Boolean(viewer.userId && reportedBy.get(viewer.userId)?.has(row.id)),
          removal:
            removal && hiding && (staff(viewer) || mineRow)
              ? { reason: removal.reason, at: removal.at, byName: staff(viewer) ? removal.by_name : null }
              : null,
          moderation: staff(viewer)
            ? {
                hidden: hiding ? { operatorName: hiding.by_name, at: hiding.at } : null,
                done: doneRow ? { operatorName: doneRow.by_name, at: doneRow.at } : null,
                held: hiding?.held ?? false,
                reports: report?.count ?? 0,
                reportReasons: report?.reasons ?? {},
                questionId: questions.get(row.id) ?? null,
                authorStaff: author?.staff ?? false,
                authorRestriction:
                  restrictions.get(row.author_user_id) ??
                  occurrenceRestrictions?.get(row.occurrence_id)?.[row.author_user_id] ??
                  null,
                ...(original !== undefined ? { originalText: original } : {}),
              }
            : null,
        };
      },
    };
  }

  /** What a viewer receives on joining: each channel's latest page, and the open reports for moderators. */
  async snapshot(viewer: LiveRoomParticipant) {
    const viewers = viewer.userId ? [viewer.userId] : [];
    const chat: LiveChatMessage[] = [];
    const chatEarlier: Partial<Record<LiveChatChannel, boolean>> = {};
    for (const channel of ["attendee", "operator"] as const) {
      const page = this.chat.page(channel, {
        before: null,
        limit: LIVE_CHAT_POLICY.snapshotMessages,
        shownOnly: !staff(viewer),
        author: viewer.userId,
        occurrenceIds: chatOccurrenceIds(viewer),
      });
      const batch = await this.viewerBatch(page.rows, viewer, viewers);
      const messages = page.rows.flatMap((row) => batch.project(row, viewer) ?? []);
      chat.push(...messages);
      if (messages.length) chatEarlier[channel] = page.hasEarlier;
    }
    const pinned = await this.pinned(viewer);
    const reportRows = staff(viewer)
      ? this.chat.messages(this.moderation.openReports(LIVE_CHAT_POLICY.reportQueueLimit))
      : [];
    const reports = await this.viewerBatch(reportRows, viewer, viewers);
    return {
      chat,
      chatEarlier,
      chatPinned: pinned,
      chatReports: reportRows.flatMap((row) => reports.project(row, viewer) ?? []),
    };
  }

  /** The attendee message pinned above the chat as this viewer sees it, or null. */
  async pinned(viewer: LiveRoomParticipant): Promise<LiveChatMessage | null> {
    const id = this.moderation.pinned();
    const row = id ? this.chat.message(id) : null;
    if (!row) return null;
    return (await this.viewerBatch([row], viewer)).project(row, viewer);
  }

  /** The page before a message this viewer holds, or the latest page. */
  private async viewerBatch(
    rows: LiveChatRow[],
    viewer: LiveRoomParticipant,
    viewers = viewer.userId ? [viewer.userId] : [],
  ) {
    return this.batch(rows, viewers, staff(viewer) ? await this.moderatorRestrictions(rows) : undefined);
  }

  async history(viewer: LiveRoomParticipant, channel: LiveChatChannel, beforeId: string | null) {
    const before = beforeId ? this.chat.message(beforeId) : null;
    if (beforeId && (!before || before.channel !== channel || !seesChatOccurrence(viewer, before.occurrence_id)))
      return null;
    const page = this.chat.page(channel, {
      before,
      limit: LIVE_CHAT_POLICY.historyPage,
      shownOnly: !staff(viewer),
      author: viewer.userId,
      occurrenceIds: chatOccurrenceIds(viewer),
    });
    const batch = await this.viewerBatch(page.rows, viewer);
    return {
      messages: page.rows.flatMap((row) => batch.project(row, viewer) ?? []),
      hasEarlier: page.hasEarlier,
    };
  }

  async eraseAnonymizedAuthors(db: DatabaseLike): Promise<LiveChatRemoval[]> {
    return this.chat.eraseAnonymizedAuthors(db);
  }
}
