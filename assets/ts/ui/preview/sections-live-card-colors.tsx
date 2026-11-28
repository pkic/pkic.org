/**
 * Up next and the check-in code in each card color, over the conference
 * field the production can put behind the overlay in its own software, so a
 * still picture shows which card reads on the brand gradient; and a board
 * scene's background in each field color.
 */
import {
  LIVE_FIELD_THEMES,
  LIVE_GRAPHIC_THEME_LABELS,
  type LiveFieldTheme,
  type LiveGraphicTheme,
} from "../../../shared/live-graphic-theme";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../../shared/live-overlay-layout-presets";
import type { LiveOverlayLayoutElements } from "../../../shared/schemas/live-overlay-layout";
import { LiveOverlayPresentation } from "../../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { sampleOverlayRoom } from "../../member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";
import type { PreviewSection } from "./PreviewShell";
import "./event-screens-preview.css";

const ROOM = sampleOverlayRoom(Date.parse("2026-11-30T10:00:00.000Z"));
const CARD_COLORS: LiveGraphicTheme[] = ["navy-glass", "navy", "smoked-glass", "frosted-glass", "deep-blue", "event"];

function cards(theme: LiveGraphicTheme): LiveRoomState {
  const { schedule, checkIn } = ROOM.stage;
  return {
    ...ROOM,
    stage: {
      ...ROOM.stage,
      question: null,
      poll: null,
      panelists: null,
      topQuestions: null,
      chatFeed: null,
      timerGraphics: [],
      schedule: schedule && { ...schedule, config: { ...schedule.config, theme } },
      checkIn: checkIn && { ...checkIn, theme },
    },
  };
}

/** A Break scene with its background on behind Up next, in one field color. */
function breakScene(fieldTheme: LiveFieldTheme): LiveOverlayLayoutElements {
  const elements = LIVE_OVERLAY_PRESET_LAYOUTS.break.elements;
  return { ...elements, background: { ...elements.schedule, visible: true, fieldTheme } };
}

export const liveCardColorSections: PreviewSection[] = [
  {
    id: "live-card-colors",
    title: "Card colors over the brand background",
    note: "Up next and the check-in code in each Colors choice; the see-through cards let the production's background show.",
    render: () => (
      <div class="pk-stack">
        {CARD_COLORS.map((theme) => (
          <figure key={theme} class="pk-stack">
            <figcaption>{LIVE_GRAPHIC_THEME_LABELS[theme]}</figcaption>
            <div class="pk-preview__screen pk-preview__field">
              <LiveOverlayPresentation view="program" layout="default" projection={cards(theme)} broadcast />
            </div>
          </figure>
        ))}
      </div>
    ),
  },
  {
    id: "live-field-colors",
    title: "Background colors in a board scene",
    note: "A Break scene with its background on: Up next sits on the background and takes its colors from the scene's choice.",
    render: () => (
      <div class="pk-stack">
        {LIVE_FIELD_THEMES.map((theme) => (
          <figure key={theme} class="pk-stack">
            <figcaption>{LIVE_GRAPHIC_THEME_LABELS[theme]}</figcaption>
            <div class="pk-preview__screen pk-preview__field">
              <LiveOverlayPresentation
                view="program"
                elements={breakScene(theme)}
                projection={cards("event")}
                broadcast
              />
            </div>
          </figure>
        ))}
      </div>
    ),
  },
];
