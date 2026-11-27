import type { ComponentType } from "preact";
import { useState } from "preact/hooks";
import { formatConjunction } from "../../../../../../../../shared/format-list";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import type { LiveProgramLayer } from "../../../../../../../../shared/live-overlay-stacking";
import { resolveLiveSceneElements } from "../../../../../../../../shared/live-scene-elements";
import { TabList } from "../../../../../../../ui/TabList";
import { sceneGraphics } from "../../settings/live-layouts/overlay-layout-graphics";
import { SceneSourcesList, useSceneEditing } from "./PreviewSceneEditor";
import "./GraphicsPanel.css";
import { formatClockInZone } from "../../../../../../../../shared/format-date";
import { resolveUpcomingRooms } from "../../../../../../../../shared/live-session-schedule";
import type { AgendaSnapshot } from "../../../../../../../../shared/schemas/event-agenda";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../../../../../../../../shared/schemas/live-session-schedule";
import { LiveChatFeedControls, LiveReactionsControls, LiveTopQuestionsControls } from "../LiveAudienceListControls";
import { LiveCheckInControls } from "../LiveCheckInControls";
import { LivePanelistControls } from "../LivePanelistControls";
import { LiveScheduleControls } from "../LiveScheduleControls";
import { LiveSpeakerWelcomeControls } from "../LiveSpeakerWelcomeControls";
import { LiveTickerControls } from "../LiveTickerControls";
import type { LiveTargets } from "../live-output-targets";

/** What comes next in this physical room, on the event's clock. */
export function nextInRoom(agenda: AgendaSnapshot | null, occurrenceId: string, roomId: string, now: number) {
  const schedule = resolveUpcomingRooms(
    agenda,
    occurrenceId,
    now,
    { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "this-room", layout: "list" },
    roomId,
  );
  const next = schedule.rooms[0];
  return next && schedule.timeZone ? { ...next, timeZone: schedule.timeZone } : null;
}

/** What every graphic row can read: the outputs, and where and when the session is. */
export interface LiveGraphicContext {
  targets: LiveTargets;
  slug: string;
  approvedAgenda: AgendaSnapshot | null;
  occurrenceId: string;
  roomId: string;
  now: number;
}

/**
 * The Graphics panel's rows, in order. A new graphic is one entry here: its
 * row (name, settings, output control over a `LiveLayer`) and when it
 * applies. The composition it toggles lives in the shared stage contract.
 */
export const LIVE_GRAPHICS: ReadonlyArray<{
  id: string;
  /** The scene graphic this row puts on and off. */
  element: LiveProgramLayer;
  applies?: (context: LiveGraphicContext) => boolean;
  Row: ComponentType<LiveGraphicContext>;
}> = [
  { id: "session", element: "panelists", Row: ({ targets }) => <LivePanelistControls targets={targets} /> },
  {
    id: "speaker-welcome",
    element: "speakerWelcome",
    Row: ({ targets }) => <LiveSpeakerWelcomeControls targets={targets} />,
  },
  {
    id: "ticker",
    element: "ticker",
    Row: ({ targets, approvedAgenda }) => <LiveTickerControls targets={targets} rooms={approvedAgenda?.rooms} />,
  },
  {
    id: "check-in",
    element: "checkIn",
    Row: ({ targets, slug, occurrenceId }) => (
      <LiveCheckInControls targets={targets} slug={slug} occurrenceId={occurrenceId} />
    ),
  },
  {
    id: "up-next",
    element: "schedule",
    Row: ({ targets, approvedAgenda, occurrenceId, roomId, now }) => {
      const next = nextInRoom(approvedAgenda, occurrenceId, roomId, now);
      return (
        <LiveScheduleControls
          targets={targets}
          detail={
            next ? `${formatClockInZone(next.startAt, next.timeZone)} · ${next.title}` : "Nothing next in this room"
          }
        />
      );
    },
  },
  {
    id: "top-questions",
    element: "topQuestions",
    Row: ({ targets }) => <LiveTopQuestionsControls targets={targets} />,
  },
  { id: "chat", element: "chat", Row: ({ targets }) => <LiveChatFeedControls targets={targets} /> },
  { id: "reactions", element: "reactions", Row: ({ targets }) => <LiveReactionsControls targets={targets} /> },
];

type GraphicsTab = "scene" | "other";

/**
 * The room's graphics beyond people and questions, each with its own
 * outputs, linked to the scene on Preview: In scene lists the ones it
 * shows, front first; Other graphics holds the rest, each saying which
 * scenes show it, so one can still be prepared. A graphic's on and off is
 * the room's and stays across scenes; the scene only decides whether, and
 * where, it shows. While Preview is unlocked, In scene is the scene's
 * sources list.
 */
export function GraphicsPanel(context: LiveGraphicContext) {
  const [tab, setTab] = useState<GraphicsTab>("scene");
  const editing = useSceneEditing();
  const { state } = context.targets;
  const elements = resolveLiveSceneElements(state, state.preview.scene);
  const applying = LIVE_GRAPHICS.filter((graphic) => graphic.applies?.(context) ?? true);
  const order = sceneGraphics(elements);
  const inScene = order.flatMap((element) => applying.filter((graphic) => graphic.element === element));
  const other = applying.filter((graphic) => !elements[graphic.element].visible);
  const scenes = liveOverlayLayoutChoices(state.overlayLayouts);
  const showsIn = (element: LiveProgramLayer) => {
    const names = scenes
      .filter((scene) => resolveLiveSceneElements(state, scene.slug)[element].visible)
      .map((scene) => scene.name);
    return names.length ? `Shows in: ${formatConjunction(names)}` : "No scene shows it";
  };
  return (
    <div class="pk-studio-graphics">
      <TabList
        label="Graphics"
        idPrefix="studio-graphics"
        activeId={tab}
        onSelect={(id) => setTab(id as GraphicsTab)}
        items={[
          { id: "scene", panelId: "studio-graphics-list", label: "In scene" },
          { id: "other", panelId: "studio-graphics-list", label: "Other graphics" },
        ]}
      />
      <div role="tabpanel" id="studio-graphics-list">
        {tab === "scene" ? (
          editing?.status === "ready" ? (
            <SceneSourcesList draft={editing.draft} />
          ) : inScene.length ? (
            inScene.map(({ id, Row }) => <Row key={id} {...context} />)
          ) : (
            <p class="pk-small pk-muted">This scene shows none of these graphics.</p>
          )
        ) : other.length ? (
          other.map(({ id, element, Row }) => (
            <div key={id}>
              <Row {...context} />
              <p class="pk-studio-graphics__scenes pk-small pk-muted">{showsIn(element)}</p>
            </div>
          ))
        ) : (
          <p class="pk-small pk-muted">The scene on Preview shows every graphic.</p>
        )}
      </div>
    </div>
  );
}
