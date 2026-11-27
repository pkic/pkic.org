import {
  LIVE_SPOT_TURN_CHOICES,
  LIVE_SPOT_TURN_SECONDS,
  liveOverlaySpotOf,
  liveOverlaySpotTurns,
} from "../../../../../../../../shared/live-overlay-spots";
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

/** A graphic's look in one scene: the QR code's, or every timer's; undefined puts back the default. */
export type GraphicLook = Pick<LiveOverlayElementPlacement, "qrLook"> | Pick<LiveOverlayElementPlacement, "timerLook">;

/** What a row's menu does to a graphic's position: see `overlay-layout-sharing.ts`. */
export type LayoutSharingAction = "unlink" | "relink" | "apply";

/** The changes a graphic's menu makes, in the graphics list and on the canvas alike. */
export interface GraphicActionHandlers {
  onShow: (element: LiveOverlayElement, visible: boolean) => void;
  onSharing: (element: LiveOverlayElement, action: LayoutSharingAction) => void;
  onTurns: (element: LiveProgramLayer, turns: number | null) => void;
  /** Sets the QR code's or the timers' look in this scene. */
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

/** The QR code's and the timers' looks, picked straight from the graphic's menu. */
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
        : [];
  return choices.map((item, index) => ({ ...item, separatorBefore: index === 0, disabled }));
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
