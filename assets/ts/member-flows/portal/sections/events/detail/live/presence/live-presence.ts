import { signal, type ReadonlySignal } from "@preact/signals";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { LIVE_PRESENCE_POLICY, livePresenceColor } from "../../../../../../../../shared/live-room-presence";
import {
  livePresenceFocusSchema,
  type LivePresence,
  type LivePresenceFocus,
  type LivePresencePointer,
  type LiveRoomClientMessage,
} from "../../../../../../../../shared/schemas/live-session-room";
import type { LivePresenceMessage } from "../../../../../../../live-session/useLiveRoom";
import type { LiveLayer } from "../live-output-targets";
import { liveDestinationOf } from "../OutputTargetControl";

/** Another operator as this desk draws them: their presence, initials, color slot and whether they just changed something. */
export interface LivePresenceMark extends LivePresence {
  color: number;
}

export interface LivePresenceController {
  /** Every other operator at this room's desk right now. */
  readonly others: ReadonlySignal<readonly LivePresenceMark[]>;
  receive(message: LivePresenceMessage): void;
  /** Forgets everyone, as when the room reconnects. */
  clear(): void;
  focus(focus: LivePresenceFocus | null): void;
  point(pointer: LivePresencePointer | null): void;
  /** This operator just changed the control they are on. */
  changed(): void;
  dispose(): void;
}

/**
 * This desk's half of operator presence: it reports where this operator is,
 * at most ten times a second with the latest state always sent last, and
 * holds where the others are. Nothing here is stored.
 */
export function createLivePresence(send: (message: LiveRoomClientMessage) => boolean): LivePresenceController {
  const others = signal<readonly LivePresenceMark[]>([]);
  const flashes = new Map<string, ReturnType<typeof setTimeout>>();
  let mine: { focus: LivePresenceFocus | null; pointer: LivePresencePointer | null; changed: boolean } = {
    focus: null,
    pointer: null,
    changed: false,
  };
  let sent = JSON.stringify({ focus: null, pointer: null });
  let sentAt = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    pending = null;
    const position = JSON.stringify({ focus: mine.focus, pointer: mine.pointer });
    if (position === sent && !mine.changed) return;
    if (!send({ type: "presence.update", ...mine })) return;
    sent = position;
    sentAt = Date.now();
    mine = { ...mine, changed: false };
  };
  const report = () => {
    if (pending) return;
    const wait = sentAt + LIVE_PRESENCE_POLICY.minIntervalMs - Date.now();
    if (wait <= 0) flush();
    else pending = setTimeout(flush, wait);
  };
  const settle = (id: string) => {
    flashes.delete(id);
    others.value = others.value.map((mark) => (mark.id === id ? { ...mark, changed: false } : mark));
  };

  return {
    others,
    receive(message) {
      if (message.type === "presence.left") {
        clearTimeout(flashes.get(message.id));
        flashes.delete(message.id);
        others.value = others.value.filter((mark) => mark.id !== message.id);
        return;
      }
      const { presence } = message;
      const previous = others.value.find((mark) => mark.id === presence.id);
      // A flash runs its course while the operator stays on the control they changed.
      const stayed = JSON.stringify(previous?.focus) === JSON.stringify(presence.focus);
      const changed = presence.changed || (stayed && (previous?.changed ?? false));
      if (presence.changed) {
        clearTimeout(flashes.get(presence.id));
        flashes.set(
          presence.id,
          setTimeout(() => settle(presence.id), LIVE_PRESENCE_POLICY.changeFlashMs),
        );
      }
      const mark = {
        ...presence,
        changed,
        color: livePresenceColor(presence.name),
      };
      others.value = [...others.value.filter((entry) => entry.id !== presence.id), mark].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    clear() {
      for (const timer of flashes.values()) clearTimeout(timer);
      flashes.clear();
      others.value = [];
      sent = JSON.stringify({ focus: null, pointer: null });
    },
    focus(focus) {
      if (JSON.stringify(focus) === JSON.stringify(mine.focus)) return;
      mine = { ...mine, focus };
      report();
    },
    point(pointer) {
      mine = { ...mine, pointer };
      report();
    },
    changed() {
      if (!mine.focus) return;
      mine = { ...mine, changed: true };
      report();
    },
    dispose() {
      if (pending) clearTimeout(pending);
      for (const timer of flashes.values()) clearTimeout(timer);
    },
  };
}

export const LivePresenceContext = createContext<LivePresenceController | null>(null);

/** The other operators, or nobody outside a control room. */
export function useLivePresence(): readonly LivePresenceMark[] {
  return useContext(LivePresenceContext)?.others.value ?? [];
}

export function useLivePresenceController(): LivePresenceController | null {
  return useContext(LivePresenceContext);
}

/** The presence id of a graphic, the same on every operator's screen whatever their layout. */
export function livePresenceItem(layer: LiveLayer): string {
  switch (layer.kind) {
    case "lowerThird":
      return `lowerThird:${layer.key}`;
    case "question":
    case "poll":
      return `${layer.kind}:${layer.id}`;
    default:
      return layer.kind;
  }
}

/**
 * The control under an element, from the stable ids its ancestors carry:
 * the panel kind, the item in it and the output button.
 */
export function livePresenceFocusAt(element: Element | null): LivePresenceFocus | null {
  const panel = element?.closest<HTMLElement>("[data-presence-panel]")?.dataset.presencePanel;
  if (!element || !panel) return null;
  const focus = {
    panel,
    item: element.closest<HTMLElement>("[data-presence-item]")?.dataset.presenceItem ?? null,
    target: liveDestinationOf(element),
  };
  const parsed = livePresenceFocusSchema.safeParse(focus);
  return parsed.success ? parsed.data : null;
}

/** How a mark reads aloud, since its ring and color say nothing to a screen reader. */
export function livePresenceLabel(mark: LivePresenceMark): string {
  return mark.changed ? `${mark.name} changed this` : `${mark.name} is here`;
}
