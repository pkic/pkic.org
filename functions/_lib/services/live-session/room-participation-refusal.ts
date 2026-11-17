import type { LiveRoomClientMessage } from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRefusal } from "./room-controls";

/** One refusal for every way a blocked person tries to post, vote or react. */
export const LIVE_PARTICIPATION_REFUSAL = {
  code: "LIVE_PARTICIPATION_BLOCKED",
  message: "A moderator blocked your posting. You can keep watching.",
} satisfies LiveRefusal;

/** What a blocked person may no longer do; reading, watching and deleting their own messages stay open. */
const PARTICIPATING_COMMANDS = new Set<LiveRoomClientMessage["type"]>([
  "chat.send",
  "chat.react",
  "chat.report",
  "question.ask",
  "question.edit",
  "question.vote",
  "question.answer",
  "question.answer.vote",
  "reaction.send",
  "poll.vote",
]);

export function liveCommandParticipates(type: LiveRoomClientMessage["type"]): boolean {
  return PARTICIPATING_COMMANDS.has(type);
}
