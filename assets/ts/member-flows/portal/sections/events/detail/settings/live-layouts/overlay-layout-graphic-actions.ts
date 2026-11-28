import {
  LIVE_SPOT_TURN_CHOICES,
  LIVE_SPOT_TURN_SECONDS,
  liveOverlaySpotOf,
  liveOverlaySpotTurns,
} from "../../../../../../../../shared/live-overlay-spots";
import {
  LIVE_FIELD_THEMES,
  LIVE_FIELD_THEME_DEFAULT,
  LIVE_GRAPHIC_THEME_LABELS,
} from "../../../../../../../../shared/live-graphic-theme";
import { isLiveProgramLayer, type LiveProgramLayer } from "../../../../../../../../shared/live-overlay-stacking";
import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayoutElements,
  type LiveQrLook,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import {
  LIVE_TIMER_PRESENTATIONS,
  LIVE_TIMER_PRESENTATION_LABELS,
} from "../../../../../../../../shared/schemas/live-session-timer";
import type { MenuItem } from "../../../../../../../ui/Menu";

/** A graphic's look in one scene: the QR code's, every timer's or the background's; undefined puts back the default. */
export type GraphicLook =
  | Pick<LiveOverlayElementPlacement, "qrLook">
  | Pick<LiveOverlayElementPlacement, "timerLook">
  | Pick<LiveOverlayElementPlacement, "fieldTheme">
  | Pick<LiveOverlayElementPlacement, "withBoardOnly">;

/** The graphic each look belongs to. */
export const graphicLookElement = (look: GraphicLook): LiveOverlayElement =>
  "qrLook" in look ? "qrCode" : "timerLook" in look ? "timer" : "background";

/** What a row's menu does to a graphic's position: see `overlay-layout-sharing.ts`. */
export type LayoutSharingAction = "unlink" | "relink" | "apply";

/** The changes a graphic's menu makes, in the graphics list and on the canvas alike. */
export interface GraphicActionHandlers {
  onShow: (element: LiveOverlayElement, visible: boolean) => void;
  onSharing: (element: LiveOverlayElement, action: LayoutSharingAction) => void;
  onTurns: (element: LiveProgramLayer, turns: number | null) => void;
  /** Sets the QR code's, the timers' or the background's look in this scene. */
  onLook: (look: GraphicLook) => void;
}

export const graphicNames = (elements: readonly LiveOverlayElement[]) =>
  elements.map((element) => LIVE_OVERLAY_ELEMENT_LABELS[element]).join(", ");

const QR_LOOKS: ReadonlyArray<{ look: LiveQrLook; label: string; description: string }> = [
  { look: "card", label: "Card", description: "In the event's colors, with the line to scan." },
  { look: "black-on-white", label: "Black on white", description: "The code alone, on its white quiet zone." },
  { look: "white-on-black", label: "White on black", description: "The code alone, for a dark scene." },
  {
    look: "black-on-clear",
    label: "Black, no background",
    description: "The code alone. Keep the picture behind it calm and light, so phones can read it.",
  },
];

/** A spot's boards show the front one, or take turns; the choice is the spot's, set on each of its boards. */
function spotActions(
  elements: LiveOverlayLayoutElements,
  element: LiveProgramLayer,
  disabled: boolean,
  { onTurns }: GraphicActionHandlers,
): MenuItem[] {
  const spot = liveOverlaySpotOf(elements, element);
  if (!spot) return [];
  const turns = liveOverlaySpotTurns(elements, spot);
  return [
    {
      id: "spot",
      label: "Spot",
      description: `Shared with ${graphicNames(spot.filter((board) => board !== element))}`,
      children: [
        {
          id: "front",
          label: "Show the front one",
          description: "Only the highest one in the list that is on shows.",
          checked: turns === null,
          disabled,
          onSelect: () => onTurns(element, null),
        },
        ...LIVE_SPOT_TURN_CHOICES.map((seconds) => ({
          id: `turns-${seconds}`,
          label: `Take turns every ${seconds} s`,
          description: seconds === LIVE_SPOT_TURN_SECONDS ? "Each graphic that is on shows in turn." : undefined,
          checked: turns === seconds,
          disabled,
          onSelect: () => onTurns(element, seconds),
        })),
      ],
    },
  ];
}

/** Auto leaves each timer in the look set for it; any other look is every timer's in this scene. */
const TIMER_LOOKS = [
  { look: undefined, label: "Auto", description: "Each timer as set in the Timers panel." },
  ...LIVE_TIMER_PRESENTATIONS.map((look) => ({
    look,
    label: LIVE_TIMER_PRESENTATION_LABELS[look],
    description: undefined,
  })),
];

const FIELD_LOOK_NOTES: Partial<Record<(typeof LIVE_FIELD_THEMES)[number], string>> = {
  event: "The conference field with its dots.",
  navy: "Solid: covers the slides or camera under it.",
};

/** The background's colors: the event's field, a solid navy panel, or a see-through one the boards on it read on. */
const FIELD_LOOKS = LIVE_FIELD_THEMES.map((theme) => ({
  theme,
  label: LIVE_GRAPHIC_THEME_LABELS[theme],
  description: FIELD_LOOK_NOTES[theme] ?? "See-through: the production's background shows.",
}));

/** When the background shows: with the scene, or only under the board on air, so the picture stays clear until one comes. */
const GROUND_SHOWS = [
  { withBoardOnly: undefined, label: "Always", description: "Whenever the scene is on." },
  {
    withBoardOnly: true,
    label: "Under the board on air",
    description: "Only while a question, poll or other board is on air, in that board's place.",
  },
] as const;

/** The QR code's, the timers' and the background's looks, picked straight from the graphic's menu. */
function lookActions(
  elements: LiveOverlayLayoutElements,
  element: LiveProgramLayer,
  disabled: boolean,
  { onLook }: GraphicActionHandlers,
): MenuItem[] {
  const choices =
    element === "qrCode"
      ? QR_LOOKS.map(({ look, label, description }) => ({
          id: `look-${look}`,
          label,
          description,
          checked: (elements.qrCode.qrLook ?? "card") === look,
          onSelect: () => onLook({ qrLook: look === "card" ? undefined : look }),
        }))
      : element === "timer"
        ? TIMER_LOOKS.map(({ look, label, description }) => ({
            id: `look-${look ?? "auto"}`,
            label,
            description,
            checked: elements.timer.timerLook === look,
            onSelect: () => onLook({ timerLook: look }),
          }))
        : element === "background"
          ? FIELD_LOOKS.map(({ theme, label, description }) => ({
              id: `look-${theme}`,
              label,
              description,
              checked: (elements.background.fieldTheme ?? LIVE_FIELD_THEME_DEFAULT) === theme,
              onSelect: () => onLook({ fieldTheme: theme === LIVE_FIELD_THEME_DEFAULT ? undefined : theme }),
            }))
          : [];
  const shows =
    element === "background"
      ? GROUND_SHOWS.map(({ withBoardOnly, label, description }) => ({
          id: `shows-${withBoardOnly ? "with-board" : "always"}`,
          label,
          description,
          checked: (elements.background.withBoardOnly ?? undefined) === withBoardOnly,
          onSelect: () => onLook({ withBoardOnly }),
        }))
      : [];
  return [choices, shows].flatMap((group) =>
    group.map((item, index) => ({ ...item, separatorBefore: index === 0, disabled })),
  );
}

/**
 * A graphic's menu: how its spot shows it, its look, whether it shares its
 * position across scenes, and taking it out of the scene.
 */
export function graphicActions(
  elements: LiveOverlayLayoutElements,
  element: LiveProgramLayer,
  disabled: boolean,
  handlers: GraphicActionHandlers,
): MenuItem[] {
  const { onShow, onSharing } = handlers;
  const sharing: MenuItem[] = elements[element].shared
    ? [
        {
          id: "unlink",
          label: "Place differently on this scene",
          tooltip: "Gives this scene its own position for the graphic. The other scenes keep the shared one.",
          disabled,
          onSelect: () => onSharing(element, "unlink"),
        },
      ]
    : [
        {
          id: "relink",
          label: "Use shared position",
          tooltip: "Drops this scene's own position and takes the one the scenes share.",
          disabled,
          onSelect: () => onSharing(element, "relink"),
        },
        {
          id: "apply",
          label: "Apply this position to all scenes",
          tooltip: "Makes this position the shared one, so every scene that shares it follows.",
          disabled,
          onSelect: () => onSharing(element, "apply"),
        },
      ];
  const spot = spotActions(elements, element, disabled, handlers);
  const looks = lookActions(elements, element, disabled, handlers);
  return [
    ...spot,
    ...looks,
    ...sharing.map((item, index) => ({ ...item, separatorBefore: index === 0 && spot.length + looks.length > 0 })),
    {
      id: "remove",
      label: "Remove from scene",
      danger: true,
      separatorBefore: true,
      disabled,
      onSelect: () => onShow(element, false),
    },
  ];
}

/** The parts of a scene draft a graphic's menu reads and changes (`useSceneDraft`). */
interface DraftForActions {
  elements: LiveOverlayLayoutElements;
  busy: boolean;
  show: GraphicActionHandlers["onShow"];
  share: GraphicActionHandlers["onSharing"];
  spotTurns: GraphicActionHandlers["onTurns"];
  look: GraphicActionHandlers["onLook"];
}

/** A graphic's menu on the canvas, for the draft's scene; the same choices as its row in the list. */
export function draftGraphicActions(draft: DraftForActions) {
  const handlers = { onShow: draft.show, onSharing: draft.share, onTurns: draft.spotTurns, onLook: draft.look };
  return (element: LiveOverlayElement): MenuItem[] =>
    isLiveProgramLayer(element) ? graphicActions(draft.elements, element, draft.busy, handlers) : [];
}
