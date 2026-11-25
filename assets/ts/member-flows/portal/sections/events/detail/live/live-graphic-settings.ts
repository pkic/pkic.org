import { useEffect, useRef, useState } from "preact/hooks";
import type { LiveStudioGraphic, LiveStudioGraphicsSetup } from "../../../../../../../shared/schemas/live-studio-setup";
import { liveLayerReplacements, sendLivePrograms, type LiveLayer, type LiveTargets } from "./live-output-targets";

/** What a settings dialog says when the room did not take a save. */
export const LIVE_SETTINGS_NOT_SENT = "The control room is reconnecting or busy. Try again when it is connected.";
/** What a settings dialog says when its save also sets up every room of the event. */
export const LIVE_SETTINGS_FOR_EVENT = "Every room of the event starts from these settings.";

/** The setup entry that holds exactly these settings. */
export type LiveStudioGraphicFor<Settings> = {
  [Graphic in LiveStudioGraphic]-?: NonNullable<LiveStudioGraphicsSetup[Graphic]> extends Settings
    ? Settings extends NonNullable<LiveStudioGraphicsSetup[Graphic]>
      ? Graphic
      : never
    : never;
}[LiveStudioGraphic];

/**
 * A graphic's settings in its row: what an output shows it with now, else
 * the event's saved setup, else the built-in one. The row follows a graphic
 * that a scene or another operator put on, so it always names what is on
 * screen. Saving new settings saves them as the event's setup, for someone
 * who sets up the studio, and replaces the graphic on every destination that
 * shows it; a destination that does not show it is left alone.
 */
export function useLiveGraphicSettings<Settings>(
  targets: LiveTargets,
  /** The settings an output shows the graphic with now; null while it is off everywhere this row reads. */
  shown: Settings | null,
  /** The settings without a saved setup; a change to them is followed like a change to the setup. */
  initial: Settings,
  layer: (settings: Settings) => LiveLayer,
  /** The graphic's entry in the event's setup; none for a graphic the setup does not hold. */
  graphic?: LiveStudioGraphicFor<Settings>,
) {
  const setup = targets.setup;
  const saved = graphic ? (setup?.graphics[graphic] as Settings | undefined) : undefined;
  const start = saved ?? initial;
  const [settings, setSettings] = useState<Settings>(shown ?? start);
  // When a scene or another operator changes what an output shows, this desk follows it; when the event's
  // setup loads or changes, the desk takes it unless an output shows the graphic. Taking the graphic off
  // air keeps the settings it had.
  const shownKey = shown ? JSON.stringify(shown) : null;
  const startKey = JSON.stringify(start);
  const showing = useRef(shownKey);
  showing.current = shownKey;
  useEffect(() => {
    if (shownKey) setSettings(JSON.parse(shownKey) as Settings);
  }, [shownKey]);
  useEffect(() => {
    if (!showing.current) setSettings(JSON.parse(startKey) as Settings);
  }, [startKey]);
  const saves = Boolean(graphic && setup?.canSave);
  /** Puts new settings on every output that shows the graphic, for this show only; whether every one took them. */
  const apply = (next: Settings): boolean => {
    if (!sendLivePrograms(targets, liveLayerReplacements(targets, layer(next)))) return false;
    setSettings(next);
    return true;
  };
  /** Saves new settings for the event, then applies them; the problem to show, or null once done. */
  const save = async (next: Settings): Promise<string | null> => {
    if (graphic && saves) {
      const problem = await setup!.saveGraphic(graphic, next as NonNullable<LiveStudioGraphicsSetup[typeof graphic]>);
      if (problem) return problem;
    }
    return apply(next) ? null : LIVE_SETTINGS_NOT_SENT;
  };
  return { settings, save, apply, saves };
}
