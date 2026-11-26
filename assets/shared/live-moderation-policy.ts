/**
 * Product policy for moderating a live session room: why an item is removed
 * or reported, and how long and how widely a person may be kept from posting.
 * The room enforces these rules; the event app and the studio show only the
 * actions they grant, so both read them from here.
 */
import type { LiveRoomRole } from "./live-session-policy";

/** Why a moderator removes an item, blocks a person, or a participant reports a message. */
export const LIVE_MODERATION_REASONS = [
  { id: "spam", label: "Spam" },
  { id: "abuse", label: "Abuse or harassment" },
  { id: "conduct", label: "Breaks the code of conduct" },
  /** Also covers nonsense and posts in another language. */
  { id: "off_topic", label: "Off topic" },
  { id: "other", label: "Something else" },
] as const;
export type LiveModerationReason = (typeof LIVE_MODERATION_REASONS)[number]["id"];
export const LIVE_MODERATION_REASON_IDS = LIVE_MODERATION_REASONS.map((reason) => reason.id) as [
  LiveModerationReason,
  ...LiveModerationReason[],
];

export function liveModerationReasonLabel(reason: LiveModerationReason): string {
  return LIVE_MODERATION_REASONS.find((entry) => entry.id === reason)?.label ?? "Something else";
}

/**
 * How a person is kept from posting. Every block leaves reading and watching
 * alone: a blocked person loses chat, questions, answers, votes, reactions
 * and reports, nothing else.
 *
 * - `paused`: a warning that ends by itself after `pauseMinutes`.
 * - `session`: this session until a room operator lifts it.
 * - `event`: every session of the event until an organizer lifts it.
 */
export const LIVE_PARTICIPATION_BLOCKS = ["paused", "session", "event"] as const;
export type LiveParticipationBlock = (typeof LIVE_PARTICIPATION_BLOCKS)[number];

export const LIVE_PARTICIPATION_POLICY = { pauseMinutes: 10 } as const;
/** The refusal code for every way a blocked person tries to post, vote or react. */
export const LIVE_PARTICIPATION_BLOCKED_CODE = "LIVE_PARTICIPATION_BLOCKED";

/** What a moderator removes or marks done from the room. */
export const LIVE_MODERATION_TARGETS = ["chat", "question", "answer"] as const;
export type LiveModerationTarget = (typeof LIVE_MODERATION_TARGETS)[number];

/** A block in force for one person; a pause has an end, the others last until lifted. */
export interface LiveParticipationRestriction {
  block: LiveParticipationBlock;
  until: string | null;
}

/** Whether a restriction still keeps its person from posting at `now`. */
export function liveRestrictionActive(restriction: LiveParticipationRestriction | null, now: number): boolean {
  if (!restriction) return false;
  return restriction.until === null || Date.parse(restriction.until) > now;
}

/** When a pause placed at `at` ends, as a UTC instant. */
export function livePauseEndsAt(at: string): string {
  return new Date(Date.parse(at) + LIVE_PARTICIPATION_POLICY.pauseMinutes * 60_000).toISOString();
}

/**
 * Who may place or lift a block. Room operators pause and block for the
 * session; only an organizer blocks for, or lifts a block on, the whole event.
 * Staff of the room are never blocked.
 */
export function canSetLiveParticipationBlock(
  viewer: { role: LiveRoomRole; organizer?: boolean },
  block: LiveParticipationBlock,
): boolean {
  if (viewer.role !== "operator") return false;
  return block === "event" ? viewer.organizer === true : true;
}

export type LiveParticipationAction = "pause" | "block" | "blockEvent" | "lift";

/**
 * The block actions a viewer has on one author, the same for chat, questions
 * and answers: never on themselves or on the room's own staff.
 */
export function liveParticipationActions(
  viewer: { role: LiveRoomRole; organizer?: boolean },
  author: { mine: boolean; staff: boolean; restriction: LiveParticipationBlock | null },
): Set<LiveParticipationAction> {
  const actions = new Set<LiveParticipationAction>();
  if (viewer.role !== "operator" || author.mine || author.staff) return actions;
  const block = author.restriction;
  if (block === null) actions.add("pause");
  if (block === null || block === "paused") actions.add("block");
  if (canSetLiveParticipationBlock(viewer, "event") && block !== "event") actions.add("blockEvent");
  if (block !== null && canSetLiveParticipationBlock(viewer, block)) actions.add("lift");
  return actions;
}
