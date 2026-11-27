import type { LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import { nowIso } from "../../utils/time";
import type { LiveRoomControls, LiveControlOutcome, LiveDeskCommand } from "./room-controls";
import type { LiveRoomGraphics } from "./room-graphics";
import type { LiveRoomOutputs } from "./room-outputs";
import type { LiveRoomPolls } from "./room-polls";
import type { LiveRoomPreparedQuestions } from "./room-prepared-questions";
import type { LiveRoomQuestions } from "./room-questions";
import type { LiveRoomTimers } from "./room-timers";
import type { LiveRoomAddedCredits } from "./room-added-credits";
import type { LiveRoomBroadcast } from "./room-broadcast";
import { advanceLiveStage } from "./room-stage-next";

/** The parts of a live room the control desk's actions change. */
export type LiveDesk = {
  questions: LiveRoomQuestions;
  preparedQuestions: LiveRoomPreparedQuestions;
  polls: LiveRoomPolls;
  controls: LiveRoomControls;
  graphics: LiveRoomGraphics;
  outputs: LiveRoomOutputs;
  addedCredits: LiveRoomAddedCredits;
  timers: LiveRoomTimers;
  broadcast: LiveRoomBroadcast;
};

/** The control desk's actions, each one a single synchronous change of the room's storage; operators only. */
export async function operateLiveDesk(
  desk: LiveDesk,
  actor: { userId: string; name: string },
  session: LiveRoomSession,
  message: LiveDeskCommand,
): Promise<LiveControlOutcome> {
  const at = nowIso();
  switch (message.type) {
    case "question.rewrite":
      return desk.questions.rewrite(actor, message.questionId, message.text, at);
    case "poll.save":
      return desk.polls.save(actor, message.pollId, message.draft, at, message.discardRemovedAnswers ?? false);
    case "poll.delete":
      return desk.polls.remove(actor, message.pollId, at);
    case "poll.status":
      return desk.polls.setStatus(actor, message.pollId, message.status, at);
    case "question.prepare":
      return desk.preparedQuestions.prepare(actor, session, message, at);
    case "question.prepared.delete":
      return desk.preparedQuestions.remove(actor, session, message.preparedId, at);
    case "question.prepared.release":
      return desk.preparedQuestions.releaseNow(actor, session, message.preparedId, at);
    case "question.prepared.window":
      return desk.preparedQuestions.setWindow(actor, session, { from: message.from, until: message.until }, at);
    case "stage.question":
      return desk.controls.putQuestionOnStage(actor, message.questionId, at);
    case "stage.lowerThird":
      return desk.controls.showLowerThird(actor, session, message.creditKey, at, message.motion);
    case "stage.panelists":
      return desk.controls.setPanelists(actor, message.panelists, at);
    case "stage.schedule":
      return desk.graphics.setSchedule(actor, message.schedule, at);
    case "stage.ticker":
      return desk.graphics.setTicker(actor, message.ticker, at);
    case "stage.set":
      return desk.graphics.setStage(actor, session, message, at);
    case "aux.set":
      return desk.graphics.setAux(actor, session, message, at);
    case "aux.scene":
      return desk.graphics.setAuxScene(actor, session, message, at);
    case "preview.set":
      return desk.graphics.setPreview(actor, session, message, at);
    case "scenes.reload":
      await desk.graphics.refresh();
      return { messages: [] };
    case "preview.take":
      return desk.graphics.takePreview(actor, session, at);
    case "speaker.message":
    case "stage.display.settings":
      return desk.outputs.setStageDisplay(actor, message, at);
    case "screen.sync":
      return desk.outputs.setScreenSync(actor, session, message.output, message.sync, at);
    case "program.clear":
      return desk.controls.clearProgram(actor, at);
    case "program.restore":
      return desk.controls.restoreProgram(actor, message.snapshotId, at);
    case "credit.add":
      return desk.addedCredits.add(actor, message.person, at);
    case "credit.update":
      return desk.addedCredits.update(actor, session, message.creditKey, message.person, at);
    case "credit.remove":
      return desk.addedCredits.remove(actor, message.creditKey, at);
    case "stage.poll":
      return desk.controls.showPoll(actor, message.pollId, at);
    case "stage.next":
      return advanceLiveStage(desk.controls, desk.polls, desk.broadcast, actor, session, message.view, at);
    case "queue.add":
      return desk.controls.enqueue(actor, session, message.view, message.itemId, at);
    case "queue.remove":
      return desk.controls.dequeue(actor, message.view, message.itemId, at);
    case "queue.move":
      return desk.controls.move(actor, message.view, message.itemId, message.direction, at);
    case "overlay.mode":
      return desk.controls.overlayMode(actor, message.mode, at);
    case "room.opening":
      return desk.controls.opening(actor, message.opening, at);
    case "timer.add":
      return desk.timers.add(actor, session, message.timer, Date.now(), at);
    case "timer.remove":
      return desk.timers.remove(actor, session, message.timerId, at);
    case "timer.adjust":
      return desk.timers.adjust(actor, session, message.timerId, message.deltaSeconds, Date.now(), at);
    case "stage.timer":
      return desk.controls.setTimer(actor, session, message.timer, message.visible, at);
    case "timer.control":
      return desk.timers.control(actor, session, message.timerId, message.action, Date.now(), at);
    case "timer.configure":
      return desk.timers.configure(actor, session, message.timerId, message.settings, Date.now(), at);
    case "timer.edit":
      return desk.timers.edit(actor, session, message.timerId, message.edit, Date.now(), at);
  }
}
