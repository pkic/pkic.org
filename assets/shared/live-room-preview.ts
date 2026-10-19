import { DEFAULT_LIVE_CHECK_IN_TEXT } from "./schemas/live-session-graphic-settings";
import { DEFAULT_LIVE_POLL_PRESENTATION } from "./schemas/live-session-poll";
import { LIVE_GRAPHIC_THEME_DEFAULTS } from "./live-graphic-theme";
import type { LiveCompositionInput, LivePreviewPatch, LiveStage } from "./schemas/live-session-room";

/**
 * Preview (PVW) is one composition per room, shared by every operator, like
 * Program and the auxiliary outputs. Operators change it layer by layer and
 * Take puts it on Program. Preview keeps its contents after a Take, as a
 * broadcast switcher does, so the next shot is built from the last one.
 */

/** The sources a composition names; the room resolves their content again from the approved agenda. */
export function liveCompositionInput(stage: LiveStage): LiveCompositionInput {
  return {
    ticker: stage.ticker ? { style: stage.ticker.style, messages: stage.ticker.messages } : null,
    panelists: stage.panelists,
    schedule: stage.schedule?.config ?? null,
    checkIn: stage.checkIn?.selection ?? null,
    checkInTheme: stage.checkIn?.theme ?? LIVE_GRAPHIC_THEME_DEFAULTS.checkIn,
    checkInText: stage.checkIn?.text ?? DEFAULT_LIVE_CHECK_IN_TEXT,
    lowerThirdMotion: stage.lowerThirdMotion,
    questionId: stage.question?.id ?? null,
    creditKey: stage.lowerThird?.key ?? null,
    pollId: stage.poll?.id ?? null,
    pollPresentation: stage.poll?.presentation ?? DEFAULT_LIVE_POLL_PRESENTATION,
    timerGraphics: stage.timerGraphics,
  };
}

/** Preview's sources with one operator's changes applied; layers the change leaves out stay as they are. */
export function mergeLivePreview(current: LiveStage, patch: LivePreviewPatch): LiveCompositionInput {
  return { ...liveCompositionInput(current), ...patch };
}
