import type { LiveChatFeedMessage } from "../../../../assets/shared/schemas/live-session-on-screen";

/**
 * The one check every attendee message passes before an output shows it, in
 * the chat graphic and the chat ticker alike. It runs after the room's own
 * moderation (hidden, held, reported, deleted, muted or banned) and after the
 * chat graphic's wait, and returns only the messages it lets through.
 *
 * Automated moderation, such as a model that flags abuse, plugs in here. It
 * may be slow or fail: a message it cannot judge in time should stay off air,
 * not hold up the others. Today no automated check runs, so every message the
 * room's moderation let through goes on.
 */
export type LiveChatOnAirFilter = (messages: readonly LiveChatFeedMessage[]) => Promise<LiveChatFeedMessage[]>;

export const filterLiveChatForAir: LiveChatOnAirFilter = async (messages) => [...messages];
