import { LiveScheduleOverlay } from "./LiveScheduleOverlay";
import { LiveTickerOverlay } from "./LiveTickerOverlay";
import "../ui/Spinner.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { LIVE_REACTIONS, type LiveReactionId } from "../../shared/live-session-policy";
import type { LivePoll } from "../../shared/schemas/live-session-poll";
import type { LiveOverlayView, LiveStage, LiveTimerGraphic } from "../../shared/schemas/live-session-room";
import type { ComponentChildren } from "preact";
import { liveTimerLayout } from "../../shared/live-timer-policy";
import type { LiveRoomState } from "./live-room-state";
import { FormFieldStatChart } from "../components/forms/FormResponseStats";
import { useLiveTimerReading } from "./useLiveCountdown";
import "./LiveOverlay.css";
import "./LiveSpeakerMessageTones.css";
import { liveSpeakerMessageFit } from "../../shared/live-room-outputs";
import { liveQuestionFit } from "../../shared/live-stage-display";
import { Avatar } from "../ui/Avatar";
import { LiveOverlayLayer } from "./LiveOverlayLayer";
import { LivePanelistsOverlay } from "./LivePanelistsOverlay";
import { LiveCheckInOverlay } from "./LiveCheckInOverlay";
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
import { LiveStageDisplay } from "./LiveStageDisplay";
import { isLiveAuxOutput, liveOutputProjection, liveOutputView } from "./live-output-projection";
import "../../design/tokens.event.generated.css";

function QuestionOverlay({ stage }: { stage: LiveStage }) {
  const question = stage.question;
  return (
    <div class="pk-live-overlay__question" data-showing={question ? "" : undefined} data-overlay-shell>
      {question ? (
        <figure key={question.id} class="pk-live-overlay__card">
          {question.authorName ? (
            <Avatar
              class="pk-live-overlay__asker"
              name={question.authorName}
              src={question.authorPhotoUrl ?? undefined}
              sizes="120px"
              decoding="async"
            />
          ) : (
            <OverlayEmblem />
          )}
          <div>
            <p class="pk-live-overlay__question-text" data-fit={liveQuestionFit(question.text)}>
              {question.text}
            </p>
            <p class="pk-live-overlay__question-asker">{question.authorName ?? "Audience question"}</p>
          </div>
        </figure>
      ) : null}
    </div>
  );
}

/** The poll on air with its live tallies, on the forms results chart; the bars grow as answers arrive. */
function PollOverlay({ stage, polls }: { stage: LiveStage; polls: readonly LivePoll[] }) {
  const poll = stage.poll ? polls.find((entry) => entry.id === stage.poll?.id) : undefined;
  return (
    <div class="pk-live-overlay__poll" data-overlay-shell>
      {poll ? (
        <figure key={poll.id} class="pk-live-overlay__card">
          <OverlayEmblem />
          <div class="pk-live-overlay__poll-body">
            <p class="pk-live-overlay__poll-question">{poll.field.label}</p>
            {poll.results ? (
              <div class="pk-live-overlay__poll-results">
                <FormFieldStatChart
                  field={poll.field}
                  stat={poll.results}
                  visualization={stage.poll?.presentation.chart ?? "bar"}
                  presentation
                />
              </div>
            ) : null}
          </div>
        </figure>
      ) : null}
    </div>
  );
}

/** A timer graphic: the timer it names, in its format, color and label. */
function TimerOverlay({ graphic, state }: { graphic: LiveTimerGraphic; state: LiveRoomState }) {
  const reading = useLiveTimerReading(graphic, state.timers, state.session);
  if (!reading) return null;
  const { timer, text, tone, label } = reading;
  return (
    <div class="pk-live-overlay__timer" data-tone={tone} data-presentation={graphic.presentation}>
      {graphic.showLogo && graphic.presentation === "ring" ? (
        <LiveCountdownEmblem text={text} running={timer.running} over={tone === "over"} />
      ) : graphic.showLogo ? (
        <div class="pk-live-overlay__timer-emblem" data-running={timer.running ? "" : undefined}>
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
  useEffect(() => {
    if (!burst) return;
    const spawned = (Object.entries(burst.counts) as Array<[LiveReactionId, number]>)
      .flatMap(([reaction, count]) => Array.from({ length: count }, () => EMOJI[reaction]))
      .slice(0, MAX_FLOATING_PER_BURST)
      .map((emoji) => ({ id: (next.current += 1), emoji, lane: next.current % 6 }));
    setFloating((current) => [...current, ...spawned]);
    const ids = new Set(spawned.map((item) => item.id));
    const clear = setTimeout(() => setFloating((current) => current.filter((item) => !ids.has(item.id))), 3200);
    return () => clearTimeout(clear);
  }, [burst?.sequence]);
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

/**
 * Pure presentation shared by the browser source and the operator's monitors;
 * no connection or credentials. An auxiliary output renders its own
 * composition: the projector and stage preview as Program does, the stage

/** The message the operators send the speaker, as its own layer on the stage display. */
function StageMessageOverlay({ message }: { message: LiveRoomState["speakerMessage"] }) {
  return (
    <div class="pk-live-overlay__stage-message">
      {message ? (
        <p
          class="pk-live-stage-display__message"
          data-speaker-tone={message.tone}
          data-fit={liveSpeakerMessageFit(message.text)}
          data-flash={message.flash ? "" : undefined}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** How an output is being watched: a browser source on air plays motion even where a monitor would not. */
type DrawContext = { placement: LiveOverlayElementPlacement; animate: boolean };
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
    draw: (state) =>
      state.stage.panelists ? <LivePanelistsOverlay session={state.session} panelists={state.stage.panelists} /> : null,
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
  { element: "question", draw: (state) => <QuestionOverlay stage={state.stage} /> },
  {
    element: "lowerThird",
    draw: (state, { animate }) => (
      <LiveLowerThird
        credit={state.stage.lowerThird}
        animate={animate && state.stage.lowerThirdMotion === "animated"}
      />
    ),
  },
  { element: "poll", draw: (state) => <PollOverlay stage={state.stage} polls={state.polls} /> },
  {
    element: "timer",
    draw: () => null,
  },
  {
    element: "ticker",
    draw: (state) => (state.stage.ticker?.segments.length ? <LiveTickerOverlay ticker={state.stage.ticker} /> : null),
  },
  { element: "reactions", draw: (state) => <ReactionsOverlay burst={state.burst} /> },
];

/** The stage display's layers: the speaker-facing screen, the code to check in, and the operators' message on top. */
const STAGE_DISPLAY_LAYERS = (roomId: string | undefined): readonly Layer[] => [
  { element: "stageDisplay", draw: (state) => <LiveStageDisplay state={state} roomId={roomId} /> },
  {
    element: "checkIn",
    draw: (state) => (state.stage.checkIn ? <LiveCheckInOverlay checkIn={state.stage.checkIn} /> : null),
  },
  { element: "stageMessage", draw: (state) => <StageMessageOverlay message={state.speakerMessage} /> },
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
}) {
  const animate = broadcast || !prefersReducedMotion();
  const state = projection && isLiveAuxOutput(requested) ? liveOutputProjection(projection, requested) : projection;
  const view = liveOutputView(requested);
  const elements = draft ?? resolveLiveOverlayLayout(state?.overlayLayouts ?? [], layout);
  const layers = view === "stage-display" ? STAGE_DISPLAY_LAYERS(roomId) : PROGRAM_LAYERS;
  return (
    <div class="pk-live-overlay__frame">
      <div class="pk-live-overlay" data-view={requested} data-status={status}>
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
              const content = placement.visible ? draw(state, { placement, animate }) : null;
              return content ? (
                <LiveOverlayLayer
                  key={element}
                  element={element}
                  dimmed={focus !== null && focus !== element}
                  placement={placement}
                >
                  {content}
                </LiveOverlayLayer>
              ) : null;
            })
          : null}
      </div>
    </div>
  );
}
