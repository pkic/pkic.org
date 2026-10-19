/**
 * Product policy for a session's live chat: the reaction set, the report
 * reasons, the per-person limits, the history window and who may do what to
 * a message. The room enforces these rules and the browser shows only the
 * actions they grant, so the two read them from here.
 */
import type { LiveRoomRole } from "./live-session-policy";

/** The fixed message reactions, in display order. One of each per person per message. */
export const LIVE_CHAT_REACTIONS = [
  { id: "thumbs_up", emoji: "👍", label: "Thumbs up" },
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "laugh", emoji: "😂", label: "Laugh" },
  { id: "wow", emoji: "😮", label: "Surprised" },
  { id: "applause", emoji: "👏", label: "Applause" },
  { id: "thinking", emoji: "🤔", label: "Thinking" },
] as const;
export type LiveChatReactionId = (typeof LIVE_CHAT_REACTIONS)[number]["id"];
export const LIVE_CHAT_REACTION_IDS = LIVE_CHAT_REACTIONS.map((reaction) => reaction.id) as [
  LiveChatReactionId,
  ...LiveChatReactionId[],
];

/** Why a participant reports a message; moderators see the count per reason. */
export const LIVE_CHAT_REPORT_REASONS = [
  { id: "abuse", label: "Abuse or harassment" },
  { id: "conduct", label: "Breaks the code of conduct" },
  { id: "spam", label: "Spam" },
  { id: "other", label: "Something else" },
] as const;
export type LiveChatReportReason = (typeof LIVE_CHAT_REPORT_REASONS)[number]["id"];
export const LIVE_CHAT_REPORT_REASON_IDS = LIVE_CHAT_REPORT_REASONS.map((reason) => reason.id) as [
  LiveChatReportReason,
  ...LiveChatReportReason[],
];

/** An organizer's restriction on one person for the rest of the session. */
export const LIVE_CHAT_RESTRICTIONS = ["muted", "banned"] as const;
export type LiveChatRestriction = (typeof LIVE_CHAT_RESTRICTIONS)[number];

export const LIVE_CHAT_POLICY = {
  /** Messages per channel a viewer receives on joining; earlier ones load on request. */
  snapshotMessages: 50,
  /** Messages per "load earlier" request. */
  historyPage: 50,
  /** Messages per channel the room keeps; older ones are dropped with their reactions and reports. */
  storedMessages: 2000,
  /** Messages per channel a browser holds at most; the list renders only the rows in view. */
  clientWindow: 400,
  reactionsPerPerson: { limit: 30, windowSeconds: 10 },
  reportsPerPerson: { limit: 5, windowSeconds: 60 },
  historyRequestsPerPerson: { limit: 10, windowSeconds: 10 },
  /** Author cards a person may open; each resolves only someone who wrote here. */
  authorLookupsPerPerson: { limit: 20, windowSeconds: 10 },
  /** Reaction counts are gathered, then broadcast together at most this often. */
  reactionBroadcastMilliseconds: 1000,
  /**
   * A message reported by this many different people is held: attendees stop
   * seeing it until a moderator keeps or hides it. With thousands of people
   * chatting, spam outruns any operator; five separate signed-in, registered
   * reporters are costly to fake, the hold is reversible, and every hold is
   * audited. Below the threshold a report only reaches the moderators.
   */
  reportHoldThreshold: 5,
  /** Open reports a moderator receives at once, newest first. */
  reportQueueLimit: 100,
  /** The chat ticker shows this many of the latest messages. */
  tickerMessages: 5,
  /** New chat refreshes a chat ticker at most this often. */
  tickerRefreshMilliseconds: 5000,
  /** Characters of one message the ticker shows. */
  tickerMessageLength: 140,
} as const;

/** What a viewer may do to chat: everyone takes part, moderators run the room, organizers also restrict people. */
export type LiveChatCapacity = "participant" | "moderator" | "organizer";

export function liveChatCapacity(viewer: { role: LiveRoomRole; organizer?: boolean }): LiveChatCapacity {
  if (viewer.role !== "operator") return "participant";
  return viewer.organizer ? "organizer" : "moderator";
}

export const LIVE_CHAT_ACTIONS = [
  "send",
  "react",
  "report",
  "delete",
  "hide",
  "keep",
  "convert",
  "mute",
  "ban",
  "lift",
] as const;
export type LiveChatAction = (typeof LIVE_CHAT_ACTIONS)[number];

/** What the policy needs to know about one message. */
export interface LiveChatActionSubject {
  channel: "attendee" | "operator";
  mine: boolean;
  /** Hidden from attendees by a moderator, or held after reports. */
  hidden: boolean;
  /** Held after reports and not yet reviewed. */
  held: boolean;
  reported: boolean;
  reportedByMe: boolean;
  converted: boolean;
  /** The author operates this room, so no one restricts them from chat. */
  authorStaff: boolean;
  authorRestriction: LiveChatRestriction | null;
}

/**
 * The actions one viewer may take on one message. The room checks every
 * request against this set; the message menu offers exactly this set.
 *
 * | Action  | Participant         | Moderator          | Organizer          |
 * | ------- | ------------------- | ------------------ | ------------------ |
 * | send    | unless restricted   | yes                | yes                |
 * | react   | unless restricted   | yes                | yes                |
 * | report  | others' messages    | no (hides instead) | no (hides instead) |
 * | delete  | own messages        | own messages       | own messages       |
 * | hide    | no                  | any shown message  | any shown message  |
 * | keep    | no                  | held or reported   | held or reported   |
 * | convert | no                  | attendee messages  | attendee messages  |
 * | mute    | no                  | no                 | attendees          |
 * | ban     | no                  | no                 | attendees          |
 * | lift    | no                  | no                 | restricted people  |
 */
export function liveChatActions(
  capacity: LiveChatCapacity,
  restriction: LiveChatRestriction | null,
  message: LiveChatActionSubject,
): Set<LiveChatAction> {
  const actions = new Set<LiveChatAction>();
  const staff = capacity !== "participant";
  if (restriction === "banned") return actions;
  if (!restriction && !message.hidden) actions.add("react");
  if (message.mine) actions.add("delete");
  if (!staff && !message.mine && !message.hidden && message.channel === "attendee" && !message.reportedByMe)
    actions.add("report");
  if (staff) {
    if (!message.hidden || message.held) actions.add("hide");
    if (message.hidden || message.reported) actions.add("keep");
    if (message.channel === "attendee" && !message.hidden && !message.converted) actions.add("convert");
  }
  if (capacity === "organizer" && !message.mine && !message.authorStaff && message.channel === "attendee") {
    if (message.authorRestriction === null) actions.add("mute");
    if (message.authorRestriction !== "banned") actions.add("ban");
    if (message.authorRestriction !== null) actions.add("lift");
  }
  return actions;
}

/** Whether a viewer may write in a channel at all. */
export function liveChatCanSend(
  capacity: LiveChatCapacity,
  restriction: LiveChatRestriction | null,
  channel: "attendee" | "operator",
): boolean {
  if (channel === "operator") return capacity !== "participant";
  return restriction === null;
}

/**
 * Links in chat: absolute web and mail addresses only. A relative address
 * would act on this site with the reader's session; anything else is not a
 * place a chat link should take anyone.
 */
export function liveChatSafeLink(href: string): string | null {
  if (!href || href.length > 2000 || [...href].some((character) => character.charCodeAt(0) <= 32)) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A message's words without its Markdown marks, for a question or the ticker:
 * emphasis and code marks go, a link keeps its text, line breaks become spaces.
 */
export function liveChatPlainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/(\*\*|__)(.+?)\1/gu, "$2")
    .replace(/(\*|_)(.+?)\1/gu, "$2")
    .replace(/\\([\\`*_{}[\]()#+.!|<>-])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}
