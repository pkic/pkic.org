import { LiveScheduleOverlay } from "./LiveScheduleOverlay";
import { LiveTickerOverlay } from "./LiveTickerOverlay";
import "../ui/Spinner.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { LIVE_REACTIONS, type LiveReactionId } from "../../shared/live-session-policy";
import type { LiveOverlayView, LiveTimerGraphic } from "../../shared/schemas/live-session-room";
import type { ComponentChildren } from "preact";
import { liveTimerLayout } from "../../shared/live-timer-policy";
import type { LiveRoomState } from "./live-room-state";
import { useLiveTimerGraphicReading } from "./useLiveCountdown";
import { LiveTimerSounds } from "./useLiveTimerSounds";
import "./LiveOverlay.css";
import { liveStageDisplayGraphics } from "../../shared/live-stage-display-plan";
import { liveScreenProgram } from "../../shared/live-screen-sync";
import { LiveOverlayFrame } from "./LiveOverlayFrame";
import { LiveOverlayLayer } from "./LiveOverlayLayer";
import { LivePanelistsOverlay } from "./LivePanelistsOverlay";
import { LivePanelQuestionOverlay } from "./LivePanelQuestionOverlay";
import { LivePollOverlay } from "./LivePollOverlay";
import { LiveQuestionOverlay } from "./LiveQuestionOverlay";
import { LiveCheckInOverlay } from "./LiveCheckInOverlay";
import { LiveChatFeedOverlay, LiveTopQuestionsOverlay } from "./LiveAudienceListsOverlay";
import type {
  LiveOverlayElement,
  LiveOverlayElementPlacement,
  LiveOverlayLayoutElements,
} from "../../shared/schemas/live-overlay-layout";
import { overlayBoxPixels } from "../../shared/live-overlay-geometry";
import { resolveLiveOverlayLayout } from "../../shared/live-overlay-layout-presets";
import { LiveCountdownEmblem } from "./LiveCountdownEmblem";
import { OverlayEmblem } from "./LiveEmblem";
import { LiveLowerThird } from "./LiveLowerThird";
import { LiveStageDisplay, LiveStageDisplayBanner } from "./LiveStageDisplay";
import { isLiveAuxOutput, liveOutputProjection, liveOutputView } from "./live-output-projection";
import "../../design/tokens.event.generated.css";

/** A timer graphic: the timer it names, in its format, color and label. */
function TimerOverlay({ graphic, state }: { graphic: LiveTimerGraphic; state: LiveRoomState }) {
  const reading = useLiveTimerGraphicReading(graphic, state.timers, state.session);
  if (!reading) return null;
  const { running, text, tone, label } = reading;
  return (
    <div class="pk-live-overlay__timer" data-tone={tone} data-presentation={graphic.presentation}>
      {graphic.showLogo && graphic.presentation === "ring" ? (
        <LiveCountdownEmblem text={text} running={running} over={tone === "over"} />
      ) : graphic.showLogo ? (
        <div class="pk-live-overlay__timer-emblem" data-running={running ? "" : undefined}>
          <OverlayEmblem />
        </div>
      ) : null}
      <div>
        {label ? <p class="pk-live-overlay__timer-label">{label}</p> : null}
        {graphic.presentation === "digital" || !graphic.showLogo ? (
          <span class="pk-live-overlay__timer-value">{text}</span>
        ) : null}
      </div>
    </div>
  );
}

const EMOJI = Object.fromEntries(LIVE_REACTIONS.map((reaction) => [reaction.id, reaction.emoji])) as Record<
  LiveReactionId,
  string
>;
/** A burst shows at most this many floating reactions, however large it was. */
const MAX_FLOATING_PER_BURST = 24;

function ReactionsOverlay({ burst }: { burst: LiveRoomState["burst"] }) {
  const [floating, setFloating] = useState<Array<{ id: number; emoji: string; lane: number }>>([]);
  const next = useRef(0);
  const latestBurst = useRef(burst);
  latestBurst.current = burst;
  const burstSequence = burst?.sequence;
  useEffect(() => {
    const burst = latestBurst.current;
    if (!burst) return;
    const spawned = (Object.entries(burst.counts) as Array<[LiveReactionId, number]>)
      .flatMap(([reaction, count]) => Array.from({ length: count }, () => EMOJI[reaction]))
      .slice(0, MAX_FLOATING_PER_BURST)
      .map((emoji) => ({ id: (next.current += 1), emoji, lane: next.current % 6 }));
    setFloating((current) => [...current, ...spawned]);
    const ids = new Set(spawned.map((item) => item.id));
    const clear = setTimeout(() => setFloating((current) => current.filter((item) => !ids.has(item.id))), 3200);
    return () => clearTimeout(clear);
  }, [burstSequence]);
  return (
    <div class="pk-live-overlay__reactions" aria-hidden="true">
      {floating.map((item) => (
        <span key={item.id} class={`pk-live-overlay__reaction pk-live-overlay__reaction--lane-${item.lane}`}>
          {item.emoji}
        </span>
      ))}
    </div>
  );
}

/** How an output is being watched: a browser source on air plays motion even where a monitor would not. */
type DrawContext = {
  placement: LiveOverlayElementPlacement;
  animate: boolean;
  /** The question's and panelists' boxes joined, when the layout stacks them and both are on air. */
  panel: LiveOverlayElementPlacement | null;
};

const EDGE = 0.001;

/**
 * The one box a layout's question and panelists fill together when it stacks
 * them, edge to edge at the same width, so both on air draw as one board with
 * one field and one logo. Null when they are apart, overlap or one is hidden.
 */
export function stackedPanelBox(elements: LiveOverlayLayoutElements): LiveOverlayElementPlacement | null {
  const { question, panelists } = elements;
  if (!question.visible || !panelists.visible) return null;
  if (Math.abs(question.x - panelists.x) > EDGE || Math.abs(question.w - panelists.w) > EDGE) return null;
  const [top, bottom] = question.y <= panelists.y ? [question, panelists] : [panelists, question];
  if (Math.abs(top.y + top.h - bottom.y) > EDGE) return null;
  return { ...question, y: top.y, h: top.h + bottom.h, horizontal: "center", vertical: "middle" };
}
type Layer = {
  element: LiveOverlayElement;
  /** Draws the element for the room; a graphic that adapts to its box reads the placement. */
  draw: (state: LiveRoomState, context: DrawContext) => ComponentChildren | null;
};

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Program's layers, bottom to top; each draws only while the room has something for it. */
const PROGRAM_LAYERS: readonly Layer[] = [
  {
    element: "panelists",
    draw: (state, { placement, panel }) =>
      panel ? (
        <LivePanelQuestionOverlay stage={state.stage} session={state.session} box={overlayBoxPixels(panel)} />
      ) : state.stage.panelists ? (
        <LivePanelistsOverlay
          session={state.session}
          panelists={state.stage.panelists}
          box={overlayBoxPixels(placement)}
        />
      ) : null,
  },
  {
    element: "schedule",
    draw: (state, { placement }) =>
      state.stage.schedule ? (
        <LiveScheduleOverlay schedule={state.stage.schedule} box={overlayBoxPixels(placement)} />
      ) : null,
  },
  {
    element: "checkIn",
    draw: (state) => (state.stage.checkIn ? <LiveCheckInOverlay checkIn={state.stage.checkIn} /> : null),
  },
  {
    element: "question",
    draw: (state, { placement, panel }) =>
      state.stage.question && !panel ? (
        <LiveQuestionOverlay stage={state.stage} credits={state.session.credits} box={overlayBoxPixels(placement)} />
      ) : null,
  },
  {
    element: "lowerThird",
    draw: (state, { animate }) => (
      <LiveLowerThird
        credit={state.stage.lowerThird}
        animate={animate && state.stage.lowerThirdMotion === "animated"}
      />
    ),
  },
  {
    element: "poll",
    draw: (state, { placement }) =>
      state.stage.poll ? (
        <LivePollOverlay stage={state.stage} polls={state.polls} box={overlayBoxPixels(placement)} />
      ) : null,
  },
  {
    element: "topQuestions",
    draw: (state, { placement }) =>
      state.stage.topQuestions?.questions.length ? (
        <LiveTopQuestionsOverlay list={state.stage.topQuestions} box={overlayBoxPixels(placement)} />
      ) : null,
  },
  {
    element: "chat",
    draw: (state, { placement }) =>
      state.stage.chatFeed?.messages.length ? (
        <LiveChatFeedOverlay list={state.stage.chatFeed} box={overlayBoxPixels(placement)} />
      ) : null,
  },
  {
    element: "timer",
    draw: () => null,
  },
  {
    element: "ticker",
    draw: (state) => (state.stage.ticker?.segments.length ? <LiveTickerOverlay ticker={state.stage.ticker} /> : null),
  },
  // Reactions float only while an operator has them on for this output.
  { element: "reactions", draw: (state) => (state.stage.reactions ? <ReactionsOverlay burst={state.burst} /> : null) },
];

/**
 * The stage display's layers: the speaker-facing screen, the code to check
 * in, and the banner over its top row. The screen and the banner read the
 * room as it is (`room`), weighing the display's own composition against
 * Program; the check-in code is the display's own.
 */
const STAGE_DISPLAY_LAYERS = (
  room: LiveRoomState,
  roomId: string | undefined,
  aside: ComponentChildren,
  bannerShown: boolean,
): readonly Layer[] => [
  {
    element: "stageDisplay",
    draw: () => <LiveStageDisplay state={room} roomId={roomId} aside={aside} bannerShown={bannerShown} />,
  },
  {
    element: "checkIn",
    draw: (state) => (state.stage.checkIn ? <LiveCheckInOverlay checkIn={state.stage.checkIn} /> : null),
  },
  { element: "stageMessage", draw: () => <LiveStageDisplayBanner state={room} roomId={roomId} /> },
];

/**
 * Pure presentation shared by the browser source, the operator's monitors
 * and the layout editor; no connection or credentials. The output decides
 * what is on air: the projector and stage preview draw their own composition
 * as Program does, the stage display its speaker-facing screen. The layout
 * decides which of those elements show and where.
 */
export function LiveOverlayPresentation({
  view: requested,
  layout = null,
  elements: draft,
  projection,
  status = "live",
  roomId,
  focus = null,
  broadcast = false,
  stageAside,
  playsSounds = false,
  children,
}: {
  view: LiveOverlayView;
  /** The layout the source names; an unknown one draws the event's default. */
  layout?: string | null;
  /** Unsaved element boxes, drawn in place of a saved layout (the layout editor's canvas). */
  elements?: LiveOverlayLayoutElements;
  projection: LiveRoomState | null;
  status?: string;
  /** The physical room, so the stage display names what comes next in it. */
  roomId?: string;
  /** The one element drawn in full; the others are dimmed (the layout editor's selected element). */
  focus?: LiveOverlayElement | null;
  /** A browser source on air: it plays graphic motion even under reduced motion, which only monitors honor. */
  broadcast?: boolean;
  /** Drawn at the end of the stage display's bottom line by the page that hosts it, such as a screen's status. */
  stageAside?: ComponentChildren;
  /** A real output, not a monitor of one: it plays the cues of the timers it shows that sound on the outputs. */
  playsSounds?: boolean;
  /** Drawn over every layer by the page that hosts the output, such as a screen's connection status. */
  children?: ComponentChildren;
}) {
  const animate = broadcast || !prefersReducedMotion();
  const state = projection && isLiveAuxOutput(requested) ? liveOutputProjection(projection, requested) : projection;
  const view = liveOutputView(requested);
  const elements = draft ?? resolveLiveOverlayLayout(state?.overlayLayouts ?? [], layout);
  const layers =
    view === "stage-display" && projection
      ? STAGE_DISPLAY_LAYERS(projection, roomId, stageAside, elements.stageMessage.visible)
      : PROGRAM_LAYERS;
  // An output sounds the timers it shows: the stage display its own and those on Program, any other its own.
  const shown =
    view === "stage-display" && projection
      ? liveStageDisplayGraphics(
          projection.outputs["stage-display"],
          liveScreenProgram(projection.stage, projection.screenSync, "stage-display"),
          projection.timers,
        )
      : (state?.stage.timerGraphics ?? []);
  // The stage display draws its timers itself, so its own layer decides whether they show.
  const timersShow = view === "stage-display" ? elements.stageDisplay.visible : elements.timer.visible;
  const panel =
    state?.stage.question && state.stage.panelists && view !== "stage-display" ? stackedPanelBox(elements) : null;
  const sounding =
    playsSounds && state && timersShow
      ? state.timers.filter((timer) => shown.some((graphic) => graphic.timerId === timer.id))
      : null;
  return (
    <LiveOverlayFrame view={requested} status={status}>
      {sounding?.length && state ? <LiveTimerSounds timers={sounding} session={state.session} /> : null}
      {state
        ? layers.map(({ element, draw }) => {
            const placement = elements[element];
            if (element === "timer" && placement.visible)
              return state.stage.timerGraphics.map((graphic, _index, graphics) => {
                const stacked = graphics.filter((entry) => entry.placement === "layout");
                const count = graphic.placement === "layout" ? stacked.length : 1;
                const slotIndex = stacked.findIndex((entry) => entry.timerId === graphic.timerId);
                const slot =
                  graphic.placement === "layout"
                    ? { ...placement, h: placement.h / count, y: placement.y + (slotIndex * placement.h) / count }
                    : placement;
                return (
                  <LiveOverlayLayer
                    key={`timer:${graphic.timerId}`}
                    element="timer"
                    dimmed={focus !== null && focus !== "timer"}
                    placement={liveTimerLayout(graphic, slot)}
                  >
                    <TimerOverlay graphic={graphic} state={state} />
                  </LiveOverlayLayer>
                );
              });
            const content = placement.visible ? draw(state, { placement, animate, panel }) : null;
            const joined = element === "panelists" && panel !== null;
            return content ? (
              <LiveOverlayLayer
                key={joined ? "panel" : element}
                element={element}
                dimmed={focus !== null && focus !== element && !(joined && focus === "question")}
                placement={joined ? panel : placement}
              >
                {content}
              </LiveOverlayLayer>
            ) : null;
          })
        : null}
      {children}
    </LiveOverlayFrame>
  );
}
