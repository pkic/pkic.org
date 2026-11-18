import { useEffect, useState } from "preact/hooks";
import { liveLayerReplacements, sendLivePrograms, type LiveLayer, type LiveTargets } from "./live-output-targets";

/** What a settings dialog says when the room did not take a save. */
export const LIVE_SETTINGS_NOT_SENT = "The control room is reconnecting or busy. Try again when it is connected.";

/**
 * A graphic's settings in its row: what an output shows it with now, else
 * this operator's last choice. The row follows a graphic that a scene or
 * another operator put on, so it always names what is on screen. Saving new
 * settings replaces the graphic on every destination that shows it; a
 * destination that does not show it is left alone.
 */
export function useLiveGraphicSettings<Settings>(
  targets: LiveTargets,
  /** The settings an output shows the graphic with now; null while it is off everywhere this row reads. */
  shown: Settings | null,
  initial: Settings,
  layer: (settings: Settings) => LiveLayer,
) {
  const [settings, setSettings] = useState<Settings>(shown ?? initial);
  // When a scene or another operator changes what an output shows, this desk follows it.
  const shownKey = shown ? JSON.stringify(shown) : null;
  useEffect(() => {
    if (shownKey) setSettings(JSON.parse(shownKey) as Settings);
  }, [shownKey]);
  /** Whether every output that shows the graphic took the new settings; on failure nothing changes here. */
  const save = (next: Settings): boolean => {
    if (!sendLivePrograms(targets, liveLayerReplacements(targets, layer(next)))) return false;
    setSettings(next);
    return true;
  };
  return { settings, save };
}
