import { LIVE_GRAPHIC_THEME_DEFAULTS } from "../../../../assets/shared/live-graphic-theme";
import {
  DEFAULT_LIVE_PANELISTS,
  liveSceneBringsOn,
  liveSceneSource,
  liveSessionHasPanel,
  type LiveSceneGraphic,
} from "../../../../assets/shared/live-scene-graphics";
import { LIVE_SESSION_TIMER_ID } from "../../../../assets/shared/live-timer-policy";
import type { LiveOverlayLayoutGeometry } from "../../../../assets/shared/schemas/live-overlay-layout";
import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../../../../assets/shared/schemas/live-session-graphic-settings";
import { DEFAULT_LIVE_TOP_QUESTIONS_CONFIG } from "../../../../assets/shared/schemas/live-session-on-screen";
import type {
  LiveCompositionInput,
  LivePreviewPatch,
  LiveRoomSession,
  LiveStage,
} from "../../../../assets/shared/schemas/live-session-room";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../../../../assets/shared/schemas/live-session-schedule";
import { DEFAULT_LIVE_TICKER_CONFIG } from "../../../../assets/shared/schemas/live-session-ticker";
import { defaultLiveTimerGraphic, type LiveTimer } from "../../../../assets/shared/schemas/live-session-timer";

type SceneRoom = {
  input: LiveCompositionInput;
  session: LiveRoomSession;
  /** Program's look for a graphic, which the studio's controls start from too. */
  program: LiveStage;
  timers: readonly LiveTimer[];
};

/**
 * One graphic's content as the studio's control puts it on by default, or
 * null when Preview already has it on or the room has nothing to show.
 */
function content(graphic: LiveSceneGraphic, { input, session, program, timers }: SceneRoom): LivePreviewPatch | null {
  switch (graphic) {
    case "lowerThird": {
      const first = session.credits[0];
      return input.creditKey === null && first ? { creditKey: first.key } : null;
    }
    case "timer": {
      if (input.timerGraphics.length > 0 || !timers.some((timer) => timer.id === LIVE_SESSION_TIMER_ID)) return null;
      const shown = program.timerGraphics.find((graphic) => graphic.timerId === LIVE_SESSION_TIMER_ID);
      return { timerGraphics: [shown ?? defaultLiveTimerGraphic(LIVE_SESSION_TIMER_ID)] };
    }
    case "ticker":
      if (input.ticker) return null;
      return {
        ticker: program.ticker
          ? { style: program.ticker.style, messages: program.ticker.messages }
          : DEFAULT_LIVE_TICKER_CONFIG,
      };
    case "topQuestions":
      return input.topQuestions
        ? null
        : { topQuestions: program.topQuestions?.config ?? DEFAULT_LIVE_TOP_QUESTIONS_CONFIG };
    case "panelists":
      if (input.panelists || !liveSessionHasPanel(session.credits.length)) return null;
      return { panelists: program.panelists ?? DEFAULT_LIVE_PANELISTS };
    case "schedule":
      if (input.schedule) return null;
      return { schedule: { ...(program.schedule?.config ?? DEFAULT_LIVE_SCHEDULE_CONFIG), scope: "all-rooms" } };
    case "checkIn":
      // Every session has its own code; the room resolves and signs it, and leaves it off when it cannot.
      if (input.checkIn) return null;
      return {
        checkIn: { kind: "session", occurrenceId: session.occurrenceId },
        checkInTheme: program.checkIn?.theme ?? LIVE_GRAPHIC_THEME_DEFAULTS.checkIn,
        checkInText: program.checkIn?.text ?? DEFAULT_LIVE_CHECK_IN_TEXT,
      };
  }
}

/**
 * The graphics a scene puts on when an operator loads it on Preview, each
 * with the room's own content. Only a change that names a scene brings any
 * on; a graphic Preview already has on, or that the change itself names,
 * stays as it is, and none goes off.
 */
export function liveSceneFill(
  room: Omit<SceneRoom, "input">,
  layouts: readonly LiveOverlayLayoutGeometry[],
  patch: LivePreviewPatch,
  input: LiveCompositionInput,
): LivePreviewPatch {
  if (!("scene" in patch)) return {};
  const fills = liveSceneBringsOn(liveSceneSource(layouts, input.scene)).map((graphic) =>
    content(graphic, { ...room, input }),
  );
  return Object.assign(
    {},
    ...fills.filter(
      (fill): fill is LivePreviewPatch => fill !== null && !Object.keys(fill).some((key) => key in patch),
    ),
  ) as LivePreviewPatch;
}

/** The fill without the check-in code, for a scene whose code the room cannot show. */
export function withoutLiveSceneCheckIn(fill: LivePreviewPatch): LivePreviewPatch {
  const { checkIn: _code, checkInTheme: _theme, checkInText: _text, ...rest } = fill;
  return rest;
}
