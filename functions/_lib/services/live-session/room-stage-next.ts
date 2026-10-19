import type { LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomControls } from "./room-controls";
import type { LiveRoomPolls } from "./room-polls";
import type { LiveRoomBroadcast } from "./room-broadcast";
/** Existing queued-next transition, kept separate from atomic composed shots. */
export async function advanceLiveStage(
  controls: LiveRoomControls,
  polls: LiveRoomPolls,
  broadcast: LiveRoomBroadcast,
  actor: { userId: string; name: string },
  session: LiveRoomSession,
  view: "question" | "lower-third" | "poll",
  at: string,
) {
  const taken = controls.takeNext(actor, view, at);
  if ("code" in taken) return taken;
  const shown =
    view === "question"
      ? controls.putQuestionOnStage(actor, taken.itemId, at)
      : view === "lower-third"
        ? controls.showLowerThird(actor, session, taken.itemId, at)
        : polls.advanceTo(actor, taken.itemId, at);
  if ("code" in shown) {
    await broadcast.all(taken.message);
    return shown;
  }
  return { messages: [taken.message, ...shown.messages], polls: shown.polls };
}
