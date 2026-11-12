import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { studioStorage } from "./studio-layout";

/**
 * The LIVE monitor's sound. It starts muted, which every browser plays
 * without a click; an operator who turns the sound on keeps it on in this
 * browser, like their studio layout. Only one LIVE monitor plays the sound
 * at a time: the one opened last, so a full-screen view never plays over the
 * monitor it opened from.
 */

export const STUDIO_LIVESTREAM_SOUND_STORAGE_KEY = "pkic.studio.livestreamSound";

export function loadStudioLivestreamSound(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(STUDIO_LIVESTREAM_SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/** The operator's choice, and how often they made it, so asking again for sound the browser refused is heard. */
export const studioLivestreamSound = signal({ on: loadStudioLivestreamSound(studioStorage()), asked: 0 });
/** The browser refused the sound the operator chose; the monitor plays muted until they ask again. */
export const studioLivestreamRefused = signal(false);

export function setStudioLivestreamSound(
  on: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = studioStorage(),
): void {
  studioLivestreamSound.value = { on, asked: studioLivestreamSound.value.asked + 1 };
  try {
    if (on) storage?.setItem(STUDIO_LIVESTREAM_SOUND_STORAGE_KEY, "on");
    else storage?.removeItem(STUDIO_LIVESTREAM_SOUND_STORAGE_KEY);
  } catch {
    // A full or blocked storage keeps the choice for this visit only.
  }
}

/** Whether the LIVE monitor plays sound now: the operator chose it and the browser has not refused it. */
export function studioLivestreamAudible(): boolean {
  return studioLivestreamSound.value.on && !studioLivestreamRefused.value;
}

const openMonitors = signal<readonly symbol[]>([]);

/** Whether this LIVE monitor is the one that may play sound: the one opened last. */
export function useStudioLivestreamTurn(): boolean {
  const [own] = useState(() => Symbol("LIVE monitor"));
  useEffect(() => {
    openMonitors.value = [...openMonitors.value, own];
    return () => {
      openMonitors.value = openMonitors.value.filter((entry) => entry !== own);
    };
  }, [own]);
  return openMonitors.value.at(-1) === own;
}
