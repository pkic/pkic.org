import { LiveScheduleOverlay } from "./LiveScheduleOverlay";
import { LiveTickerOverlay } from "./LiveTickerOverlay";
import type { LiveOverlayView, LiveTimerGraphic } from "../../shared/schemas/live-session-room";
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { liveTimerLayout } from "../../shared/live-timer-policy";
import type { LiveRoomState } from "./live-room-state";
import { useLiveTimerGraphicReading } from "./useLiveCountdown";
import { LiveTimerSounds } from "./useLiveTimerSounds";
import "./LiveOverlay.css";
import { liveStageDisplayGraphics } from "../../shared/live-stage-display-plan";
import { LiveOverlayFrame } from "./LiveOverlayFrame";
import {
  ALL_LIVE_OVERLAY_GRAPHICS,
  liveOverlayAllowedElements,
  liveOverlayCropElement,
  type LiveOverlayGraphics,
} from "./live-overlay-graphics";
import { LiveOverlayLayer, useLiveSceneMove } from "./LiveOverlayLayer";
import { LiveSpeakerWelcomeOverlay } from "./LiveSpeakerWelcomeOverlay";
import { BOARDS, meets, NO_TIMER_CLEARANCE, joinedPanelBox, timerClearance, within } from "./live-overlay-fields";
import { LivePanelistsOverlay } from "./LivePanelistsOverlay";
import { LivePanelQuestionOverlay } from "./LivePanelQuestionOverlay";
import { LivePollOverlay } from "./LivePollOverlay";
import { LiveQuestionOverlay } from "./LiveQuestionOverlay";
import { LiveCheckInOverlay } from "./LiveCheckInOverlay";
import { LiveReactionsOverlay } from "./LiveReactionsOverlay";
import { LiveBoardGround } from "./LiveBoard";
import { LiveQrCodeOverlay } from "./LiveQrCodeOverlay";
import { LiveChatFeedOverlay, LiveTopQuestionsOverlay } from "./LiveAudienceListsOverlay";
import type {
  LiveOverlayElement,
  LiveOverlayElementPlacement,
  LiveOverlayLayoutElements,
} from "../../shared/schemas/live-overlay-layout";
import { overlayBoxPixels } from "../../shared/live-overlay-geometry";
import { resolveLiveSceneElements } from "../../shared/live-scene-elements";
import { LiveTimerMark } from "./LiveTimerMark";
import { LiveTimerPlate } from "./LiveTimerPlate";
import { formatLiveTimerMark } from "../../shared/live-timer-format";
import { LiveLowerThird } from "./LiveLowerThird";
import { LiveStillPictures } from "./live-still-pictures";
import { LiveStageDisplay, LiveStageDisplayBanner } from "./LiveStageDisplay";
import { isLiveAuxOutput, liveOutputProjection, liveOutputScene, liveOutputView } from "./live-output-projection";
import "../../design/tokens.event.generated.css";
import { liveOverlayCoveredBy, liveOverlayDrawn, liveOverlayWaitsForTurn } from "../../shared/live-overlay-cover";
import { useLiveSpotTurns } from "./useLiveSpotTurns";
import {
  LIVE_PROGRAM_LAYER_ORDER,
  isLiveProgramLayer,
  liveOverlayClearOfTicker,
  liveProgramLayers,
  type LiveProgramLayer,
} from "../../shared/live-overlay-stacking";

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

/** The cards with colors of their own, which a timer never covers. */
const CARD_BOARDS: ReadonlySet<LiveOverlayElement> = new Set(["schedule", "checkIn"]);

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
/** The timers as this scene shows them: in the scene's look when it sets one, else each in its own. */
function sceneTimerLook(graphics: readonly LiveTimerGraphic[], box: LiveOverlayElementPlacement) {
  const look = box.timerLook;
  return look ? graphics.map((graphic) => ({ ...graphic, presentation: look })) : graphics;
}

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

/** How an output is being watched: a browser source on air plays motion even where a monitor would not. */
type DrawContext = {
  placement: LiveOverlayElementPlacement;
  animate: boolean;
  /** The question's and panelists' boxes joined, when the layout stacks them and both are on air. */
  panel: LiveOverlayElementPlacement | null;
  /** The event the output belongs to, for links its graphics carry; none on a sample. */
  eventSlug: string | null;
};

type Layer = {
  element: LiveOverlayElement;
  /** Draws the element for the room; a graphic that adapts to its box reads the placement. */
  draw: (state: LiveRoomState, context: DrawContext) => ComponentChildren | null;
};

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Program's layers, each drawn only while the room has something for it, in
 * the one order they keep in the document. A scene stacks them
 * (`liveProgramLayers`), in the order the studio also reads to tell a graphic
 * a board hides; that order reaches each layer as its `order`, never as its
 * place in the document, so a scene change leaves every graphic's node alone.
 */
const PROGRAM_LAYERS: ReadonlyMap<LiveProgramLayer, Layer> = new Map(
  (
    [
      {
        element: "background",
        // The one field of the frame: drawn whenever the scene includes it, with or without a board on it.
        draw: (_state, { placement }) => <LiveBoardGround box={overlayBoxPixels(placement)} />,
      },
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
            <LiveQuestionOverlay
              stage={state.stage}
              credits={state.session.credits}
              box={overlayBoxPixels(placement)}
            />
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
        element: "speakerWelcome",
        draw: (state) => (state.stage.speakerWelcome ? <LiveSpeakerWelcomeOverlay session={state.session} /> : null),
      },
      {
        element: "qrCode",
        draw: (state, { eventSlug, placement }) => (
          <LiveQrCodeOverlay
            eventSlug={eventSlug}
            occurrenceId={state.session.occurrenceId}
            look={placement.qrLook ?? "card"}
          />
        ),
      },
      {
        element: "timer",
        draw: () => null,
      },
      {
        element: "ticker",
        draw: (state) =>
          state.stage.ticker?.segments.length ? <LiveTickerOverlay ticker={state.stage.ticker} /> : null,
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
  ).map((layer) => [layer.element, layer]),
);

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
  eventSlug = null,
  graphics = ALL_LIVE_OVERLAY_GRAPHICS,
  children,
}: {
  view: LiveOverlayView;
  /** The scene the source names; none draws the output's own scene, and an unknown one the event's default. */
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
  /** The event the output belongs to, for the links its graphics carry, such as the QR code's. */
  eventSlug?: string | null;
  /** Which graphics a browser source draws, and whether it crops to the one left. */
  graphics?: LiveOverlayGraphics;
  /** Drawn over every layer by the page that hosts the output, such as a screen's connection status. */
  children?: ComponentChildren;
}) {
  // A still picture cuts between states; a browser source on air moves even under reduced motion.
  const still = useContext(LiveStillPictures);
  const animate = !still && (broadcast || !prefersReducedMotion());
  const state = projection && isLiveAuxOutput(requested) ? liveOutputProjection(projection, requested) : projection;
  const view = liveOutputView(requested);
  // The scene on this output, whose change moves the graphics that stay on. The editor's unsaved boxes are no
  // scene: dragging one places its graphic at once.
  const scene = draft ? null : (layout ?? liveOutputScene(state, requested));
  const moving = useLiveSceneMove(scene);
  // The scene decides what can draw and where; a source drawing only some graphics leaves the others out,
  // and while the ticker is on air, every other graphic keeps clear of it.
  const allowed = liveOverlayAllowedElements(draft ?? resolveLiveSceneElements(state, scene), graphics);
  const elements = liveOverlayClearOfTicker(
    allowed,
    view !== "stage-display" && state !== null && allowed.ticker.visible && liveOverlayDrawn(state.stage, "ticker"),
  );
  // A spot whose boards take turns shows one at a time, the same one on every output.
  const now = useLiveSpotTurns(elements);
  const cropped = liveOverlayCropElement(graphics, view === "stage-display" ? "stage-display" : "program");
  // The stage display stacks its layers as listed; Program's keep their own order and the scene stacks them.
  const speaker = view === "stage-display" ? projection : null;
  const stack = speaker ? null : liveProgramLayers(elements);
  const layers = speaker
    ? STAGE_DISPLAY_LAYERS(speaker, roomId, stageAside, elements.stageMessage.visible)
    : LIVE_PROGRAM_LAYER_ORDER.map((layer) => PROGRAM_LAYERS.get(layer)!);
  // An output sounds the timers it shows; the stage display only its countdowns.
  const shown =
    view === "stage-display" && state
      ? liveStageDisplayGraphics(state.stage, state.timers)
      : (state?.stage.timerGraphics ?? []);
  // The stage display draws its timers itself, so its own layer decides whether they show.
  const timersShow = view === "stage-display" ? elements.stageDisplay.visible : elements.timer.visible;
  const panel =
    state?.stage.question && state.stage.panelists && view !== "stage-display" ? joinedPanelBox(elements) : null;
  // The cards drawn now, which a timer never covers.
  const cardBoxes = state
    ? LIVE_PROGRAM_LAYER_ORDER.filter(
        (layer) => CARD_BOARDS.has(layer) && elements[layer].visible && liveOverlayDrawn(state.stage, layer),
      ).map((layer) => elements[layer])
    : [];
  // The scene's background: the frame's one field. No board draws a field of its own, inside it or outside, and
  // Up next inside it drops its card's plate, so nothing reads as a card on a card.
  const ground = view !== "stage-display" && elements.background.visible ? elements.background : null;
  const timers =
    state && view !== "stage-display" && elements.timer.visible
      ? timerSlots(sceneTimerLook(state.stage.timerGraphics, elements.timer), elements.timer, cardBoxes)
      : [];
  const timerBoxes = timers.map(({ slot }) => slot);
  const sounding =
    playsSounds && state && timersShow
      ? state.timers.filter((timer) => shown.some((graphic) => graphic.timerId === timer.id))
      : null;
  return (
    <LiveOverlayFrame view={requested} status={status} crop={cropped ? elements[cropped] : null}>
      {sounding?.length && state ? <LiveTimerSounds timers={sounding} session={state.session} /> : null}
      {/* The layers' own stacking context, so what the host page draws over the output stays over every layer. */}
      <div class="pk-live-overlay__stack">
        {state
          ? layers.flatMap(({ element, draw }, index) => {
              const order = stack && isLiveProgramLayer(element) ? stack.indexOf(element) : index;
              if (element === "timer")
                return timers.map(({ graphic, slot, mark, tab }) => (
                  <LiveOverlayLayer
                    key={`timer:${graphic.timerId}`}
                    element="timer"
                    order={order}
                    moving={moving}
                    dimmed={focus !== null && focus !== "timer"}
                    placement={slot}
                  >
                    {/* A timer over the background sets its time on the field instead of on a plate. */}
                    <TimerOverlay
                      graphic={graphic}
                      state={state}
                      mark={mark}
                      tab={tab}
                      onBoard={ground !== null && meets(ground, slot)}
                    />
                  </LiveOverlayLayer>
                ));
              const placement = elements[element];
              const joined = element === "panelists" && panel !== null;
              const box = joined ? panel : placement;
              // A board covered by one in front, or waiting for its turn in a spot, is left out, as the studio's row
              // says. The background always draws, and so does the layout editor's selected element.
              // The panel joined with the question is one board at the question's place in the stack: only what
              // covers the question covers both, and a board between the two sits behind it.
              const covered =
                view !== "stage-display" &&
                element !== focus &&
                element !== "background" &&
                isLiveProgramLayer(element) &&
                (liveOverlayCoveredBy(state.stage, elements, joined ? "question" : element) !== null ||
                  liveOverlayWaitsForTurn(state.stage, elements, joined ? "question" : element, now));
              const content =
                placement.visible && !covered ? draw(state, { placement, animate, panel, eventSlug }) : null;
              return content ? (
                <LiveOverlayLayer
                  key={joined ? "panel" : element}
                  element={element}
                  order={order}
                  moving={moving}
                  on={!stack || !isLiveProgramLayer(element) || liveOverlayDrawn(state.stage, element)}
                  dimmed={focus !== null && focus !== element && !(joined && focus === "question")}
                  timerClearance={BOARDS.has(element) ? timerClearance(box, timerBoxes) : NO_TIMER_CLEARANCE}
                  onGround={element === "schedule" && ground !== null && within(box, ground)}
                  placement={box}
                >
                  {content}
                </LiveOverlayLayer>
              ) : null;
            })
          : null}
      </div>
      {children}
    </LiveOverlayFrame>
  );
}
