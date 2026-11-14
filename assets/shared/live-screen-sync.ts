import { EMPTY_LIVE_STAGE, type LiveStage } from "./schemas/live-session-room";
import type { LiveScreenSync, LiveSyncedScreen } from "./schemas/live-screen-sync";

/**
 * What a room screen takes from Program: all of it while the screen syncs,
 * nothing once an operator turned sync off. The projector and the stage
 * display read Program through here, so turning sync off never leaves a
 * graphic behind on one of them.
 */
export function liveScreenProgram(program: LiveStage, sync: LiveScreenSync, output: LiveSyncedScreen): LiveStage {
  return sync[output] ? program : EMPTY_LIVE_STAGE;
}

/**
 * A screen that syncs with Program shows what was put on it, and Program's
 * graphic wherever it has none of its own: an element the screen holds
 * itself takes the place of Program's.
 */
export function liveSyncedComposition(own: LiveStage, program: LiveStage): LiveStage {
  const question = own.question ? own : program;
  const lowerThird = own.lowerThird ? own : program;
  const poll = own.poll ? own : program;
  return {
    question: question.question,
    questionChange: question.questionChange,
    lowerThird: lowerThird.lowerThird,
    lowerThirdChange: lowerThird.lowerThirdChange,
    lowerThirdMotion: lowerThird.lowerThirdMotion,
    poll: poll.poll,
    pollChange: poll.pollChange,
    ticker: own.ticker ?? program.ticker,
    panelists: own.panelists ?? program.panelists,
    schedule: own.schedule ?? program.schedule,
    checkIn: own.checkIn ?? program.checkIn,
    timerGraphics: own.timerGraphics.length ? own.timerGraphics : program.timerGraphics,
    topQuestions: own.topQuestions ?? program.topQuestions,
    chatFeed: own.chatFeed ?? program.chatFeed,
    reactions: own.reactions || program.reactions,
  };
}
