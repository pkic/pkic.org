import { LiveScheduleOverlay } from "./LiveScheduleOverlay";
import { LiveTickerOverlay } from "./LiveTickerOverlay";
import type { LiveOverlayView, LiveTimerGraphic } from "../../shared/schemas/live-session-room";
import type { ComponentChildren } from "preact";
import { liveTimerLayout } from "../../shared/live-timer-policy";
import type { LiveRoomState } from "./live-room-state";
import { useLiveTimerGraphicReading } from "./useLiveCountdown";
import { LiveTimerSounds } from "./useLiveTimerSounds";
import "./LiveOverlay.css";
import { liveStageDisplayGraphics } from "../../shared/live-stage-display-plan";
import { LiveOverlayFrame } from "./LiveOverlayFrame";
import { LiveOverlayLayer } from "./LiveOverlayLayer";
import { LivePanelistsOverlay } from "./LivePanelistsOverlay";
import { LivePanelQuestionOverlay } from "./LivePanelQuestionOverlay";
import { LivePollOverlay } from "./LivePollOverlay";
import { LiveQuestionOverlay } from "./LiveQuestionOverlay";
import { LiveCheckInOverlay } from "./LiveCheckInOverlay";
import { LiveReactionsOverlay } from "./LiveReactionsOverlay";
import { LiveChatFeedOverlay, LiveTopQuestionsOverlay } from "./LiveAudienceListsOverlay";
import type {
  LiveOverlayElement,
  LiveOverlayElementPlacement,
  LiveOverlayLayoutElements,
} from "../../shared/schemas/live-overlay-layout";
import { overlayBoxPixels } from "../../shared/live-overlay-geometry";
import { resolveLiveOverlayLayout } from "../../shared/live-overlay-layout-presets";
import { LiveTimerMark } from "./LiveTimerMark";
import { LiveTimerPlate } from "./LiveTimerPlate";
import { formatLiveTimerMark } from "../../shared/live-timer-format";
import { LiveLowerThird } from "./LiveLowerThird";
import { LiveStageDisplay, LiveStageDisplayBanner } from "./LiveStageDisplay";
import { isLiveAuxOutput, liveOutputProjection, liveOutputView } from "./live-output-projection";
import "../../design/tokens.event.generated.css";
import { LIVE_PROGRAM_LAYER_ORDER, liveOverlayDrawn, type LiveProgramLayer } from "../../shared/live-overlay-cover";

/**
 * A timer graphic: the timer it names, readable on a corner of the stream.
 * As digits, in the look it was given (see LiveTimerPlate); as the mark, the
 * time sits in the consortium emblem (see LiveTimerMark).
 */
function TimerOverlay({
  graphic,
  state,
  mark,
  tab,
  onBoard,
}: {
  graphic: LiveTimerGraphic;
  state: LiveRoomState;
  /** Whether the frame has room for the mark here; without it the timer reads as digits. */
  mark: boolean;
  /** The edge a tab runs on to; without one a tab reads as a plate. */
  tab: TimerTab | null;
  onBoard: boolean;
}) {
  const reading = useLiveTimerGraphicReading(graphic, state.timers, state.session);
  if (!reading) return null;
  const { running, text, tone, label, shownMs, spentFraction } = reading;
  if (mark && shownMs !== null)
    return (
      <LiveTimerMark
        text={formatLiveTimerMark(shownMs)}
        shownMs={shownMs}
        spent={spentFraction}
        tone={tone}
        running={running}
        label={label}
      />
    );
  const look = graphic.presentation === "bare" ? "bare" : tab ? "tab" : "plate";
  return (
    <LiveTimerPlate
      label={label}
      text={text}
      tone={tone}
      running={running}
      look={look}
      onBoard={onBoard}
      edge={tab?.edge}
      reach={tab?.reach}
    />
  );
}

/** The space between timers stacked in the layout's timer box, in fractions of the frame's height. */
const TIMER_STACK_GAP = 16 / 1080;
/** The space between two columns of timers, in fractions of the frame's width. */
const TIMER_COLUMN_GAP = 16 / 1920;

/** The mark stands taller than the digits' plate: its box keeps the plate's width and grows from its anchor. */
const MARK_HEIGHT = 2.4;

/** The plate's own height, in px of its 336 x 120 size, for a tab's reach in the same units. */
const PLATE_HEIGHT = 120;

/** A tab: the frame edge it runs on to, and how far past the plate, in px of the plate's own size. */
type TimerTab = { edge: "top" | "bottom"; reach: number };

/**
 * A tab's box for a plate's: the plate run on to the frame's edge it sits
 * against, top or bottom. Null for a plate in the middle of the frame, or one
 * stacked under another timer, which stays a plate.
 */
function tabBox(plate: LiveOverlayElementPlacement, first: boolean) {
  if (!first || plate.h <= 0) return null;
  const reach = (past: number) => Math.round((past / plate.h) * PLATE_HEIGHT * 1000) / 1000;
  if (plate.vertical === "top")
    return {
      slot: { ...plate, y: 0, h: plate.y + plate.h },
      tab: { edge: "top", reach: reach(plate.y) } satisfies TimerTab,
    };
  if (plate.vertical === "bottom")
    return {
      slot: { ...plate, h: 1 - plate.y },
      tab: { edge: "bottom", reach: reach(1 - plate.y - plate.h) } satisfies TimerTab,
    };
  return null;
}

/** The mark's box for a plate's: as wide, taller, growing from the same anchor. */
function markBox(plate: LiveOverlayElementPlacement): LiveOverlayElementPlacement {
  const h = plate.h * MARK_HEIGHT;
  const grow = plate.vertical === "bottom" ? plate.h - h : plate.vertical === "middle" ? (plate.h - h) / 2 : 0;
  return { ...plate, h, y: plate.y + grow };
}

/**
 * Where each timer graphic sits, and whether it has room for the mark. Those
 * in the layout's box stack from it, down from a box at the top or up from
 * one at the bottom, each at the box's full size, so a second timer never
 * shrinks the first; one with a position of its own sits there. A timer
 * never covers a card (the schedule or the check-in code): one that would
 * starts a new column inward from the box, and the mark that has no room
 * reads as digits on the plate's footprint instead. A tab is the first timer
 * of its stack run on to the frame's edge; the next one sits under its plate.
 */
function timerSlots(
  graphics: readonly LiveTimerGraphic[],
  box: LiveOverlayElementPlacement,
  cards: readonly LiveOverlayElementPlacement[] = [],
) {
  const clear = (slot: LiveOverlayElementPlacement) => !cards.some((card) => meets(card, slot));
  const inward = box.horizontal === "right" ? -1 : box.horizontal === "left" ? 1 : 0;
  let offset = 0;
  let column = 0;
  return graphics.map((graphic) => {
    const plate = liveTimerLayout(graphic, box);
    const ring = graphic.presentation === "ring";
    const tabbed = graphic.presentation === "tab";
    if (graphic.placement !== "layout") {
      if (ring) return { graphic, slot: markBox(plate), mark: true, tab: null };
      const tab = tabbed ? tabBox(plate, true) : null;
      return { graphic, slot: tab?.slot ?? plate, mark: false, tab: tab?.tab ?? null };
    }
    const at = (row: number, col: number) => ({
      ...plate,
      x: plate.x + inward * col * (plate.w + TIMER_COLUMN_GAP),
      y: plate.y + (box.vertical === "bottom" ? -row : row),
    });
    const place = (row: number, col: number) => {
      const spot = at(row, col);
      if (ring && clear(markBox(spot)))
        return { slot: markBox(spot), mark: true, tab: null, advance: spot.h * MARK_HEIGHT };
      const tab = tabbed ? tabBox(spot, row === 0) : null;
      if (tab && clear(tab.slot)) return { slot: tab.slot, mark: false, tab: tab.tab, advance: spot.h };
      return clear(spot) ? { slot: spot, mark: false, tab: null, advance: spot.h } : null;
    };
    let placed = place(offset, column);
    if (!placed && offset > 0 && inward !== 0) {
      column += 1;
      offset = 0;
      placed = place(0, column);
    }
    placed ??= { slot: at(offset, column), mark: false, tab: null, advance: plate.h };
    // A tab runs on to the edge away from the stack, so the next timer goes under its plate.
    offset += placed.advance + TIMER_STACK_GAP;
    return { graphic, slot: placed.slot, mark: placed.mark, tab: placed.tab };
  });
}

/** Whether two boxes of the frame meet. */
function meets(one: LiveOverlayElementPlacement, other: LiveOverlayElementPlacement) {
  return one.x < other.x + other.w && one.x + one.w > other.x && one.y < other.y + other.h && one.y + one.h > other.y;
}

/** The cards with colors of their own, which a timer never covers. */
const CARD_BOARDS: ReadonlySet<LiveOverlayElement> = new Set(["schedule", "checkIn"]);

/** The boards drawn on the event's field; the schedule and the check-in code are cards of their own colors. */
const FIELD_BOARDS: ReadonlySet<LiveOverlayElement> = new Set([
  "question",
  "poll",
  "panelists",
  "topQuestions",
  "chat",
]);

/** The boards: each carries the logo in its top-right corner. */
const BOARDS: ReadonlySet<LiveOverlayElement> = new Set([
  "question",
  "poll",
  "panelists",
  "topQuestions",
  "chat",
  "schedule",
  "checkIn",
]);

/**
 * How much of a board's width, from its end, the timers on its logo corner
 * (the right two fifths of its top fifth) take: the board keeps that column
 * clear, so no line of it runs under a timer. Zero when none sits there.
 */
function timerReserve(board: LiveOverlayElementPlacement, timers: readonly LiveOverlayElementPlacement[]) {
  const corner = { x: board.x + board.w * 0.6, y: board.y, w: board.w * 0.4, h: board.h * 0.2 };
  const end = board.x + board.w;
  const covering = timers.filter(
    (timer) =>
      timer.x < corner.x + corner.w &&
      timer.x + timer.w > corner.x &&
      timer.y < corner.y + corner.h &&
      timer.y + timer.h > corner.y,
  );
  if (!covering.length || board.w <= 0) return 0;
  return Math.min(0.4, Math.max(...covering.map((timer) => (end - timer.x) / board.w)));
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

/**
 * Program's layers, each drawn only while the room has something for it,
 * bottom to top in the one order the studio also reads to tell a graphic a
 * board hides.
 */
const PROGRAM_LAYERS: readonly Layer[] = (
  [
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
      draw: (state, { placement, animate }) =>
        state.stage.schedule ? (
          <LiveScheduleOverlay schedule={state.stage.schedule} box={overlayBoxPixels(placement)} animate={animate} />
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
    {
      element: "reactions",
      draw: (state) =>
        state.stage.reactions ? (
          <LiveReactionsOverlay burst={state.burst} showCount={state.stage.reactionsGraphic.showCount} />
        ) : null,
    },
  ] satisfies Array<Layer & { element: LiveProgramLayer }>
).sort((a, b) => LIVE_PROGRAM_LAYER_ORDER.indexOf(a.element) - LIVE_PROGRAM_LAYER_ORDER.indexOf(b.element));

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
  // An output sounds the timers it shows; the stage display only its countdowns.
  const shown =
    view === "stage-display" && state
      ? liveStageDisplayGraphics(state.stage, state.timers)
      : (state?.stage.timerGraphics ?? []);
  // The stage display draws its timers itself, so its own layer decides whether they show.
  const timersShow = view === "stage-display" ? elements.stageDisplay.visible : elements.timer.visible;
  const panel =
    state?.stage.question && state.stage.panelists && view !== "stage-display" ? stackedPanelBox(elements) : null;
  const drawnBoards = (kinds: ReadonlySet<LiveOverlayElement>) =>
    state
      ? LIVE_PROGRAM_LAYER_ORDER.filter(
          (layer) => kinds.has(layer) && elements[layer].visible && liveOverlayDrawn(state.stage, layer),
        ).map((layer) => (layer === "panelists" && panel ? panel : elements[layer]))
      : [];
  // The boards on the field drawn now, so a timer over one sets its time on the board instead of on a plate.
  const boardBoxes = drawnBoards(FIELD_BOARDS);
  const cardBoxes = drawnBoards(CARD_BOARDS);
  const timers =
    state && view !== "stage-display" && elements.timer.visible
      ? timerSlots(state.stage.timerGraphics, elements.timer, cardBoxes)
      : [];
  const timerBoxes = timers.map(({ slot }) => slot);
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
              return timers.map(({ graphic, slot, mark, tab }) => {
                const onBoard = boardBoxes.some((board) => meets(board, slot));
                return (
                  <LiveOverlayLayer
                    key={`timer:${graphic.timerId}`}
                    element="timer"
                    dimmed={focus !== null && focus !== "timer"}
                    placement={slot}
                  >
                    <TimerOverlay graphic={graphic} state={state} mark={mark} tab={tab} onBoard={onBoard} />
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
                timerReserve={BOARDS.has(element) ? timerReserve(joined ? panel : placement, timerBoxes) : 0}
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
