import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import {
  STUDIO_LAYOUT_STORAGE_KEY,
  STUDIO_WORKSPACES,
  defaultStudioLayouts,
  hasOwnStudioLayouts,
  loadStudioLayouts,
  saveStudioWorkspace,
  studioStorage,
  type StudioLayouts,
  type StudioPanel,
} from "./studio-layout";
import type { StudioDefaultLayouts } from "../../../../../../../../shared/schemas/live-studio-layout";

export type StudioChange = (update: (panels: readonly StudioPanel[]) => StudioPanel[]) => void;

/**
 * The workspace in view follows the address, so a bookmark opens the same
 * workspace; its panel arrangement is the operator's own and stays in their
 * browser. A change saves only the workspace it changed, on top of what the
 * browser holds now, so a second studio tab never writes its older sizes
 * over this one's; and a change saved in another tab shows here too. Until
 * the operator changes anything, each workspace is the event's default
 * arrangement, else the built-in one, and Reset layout goes back to it.
 */
export function useStudioLayout(eventDefault: StudioDefaultLayouts = {}) {
  const [workspace, selectWorkspace] = useHashQueryParam("studio", "show", STUDIO_WORKSPACES);
  const [layouts, setLayouts] = useState<StudioLayouts>(() => loadStudioLayouts(studioStorage(), eventDefault));
  const latest = useRef(layouts);
  latest.current = layouts;
  const defaults = useRef(eventDefault);
  defaults.current = eventDefault;
  // The event's default arrives after the studio opens; a browser without its own arrangement takes it.
  // An arrangement changed on this page stays even where the browser cannot keep it.
  const changed = useRef(false);
  const defaultKey = JSON.stringify(eventDefault);
  useEffect(() => {
    if (changed.current || hasOwnStudioLayouts(studioStorage())) return;
    const next = defaultStudioLayouts(JSON.parse(defaultKey) as StudioDefaultLayouts);
    latest.current = next;
    setLayouts(next);
  }, [defaultKey]);
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== STUDIO_LAYOUT_STORAGE_KEY) return;
      const next = loadStudioLayouts(studioStorage(), defaults.current);
      latest.current = next;
      setLayouts(next);
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);
  const change = useCallback<StudioChange>(
    (update) => {
      changed.current = true;
      const panels = update(latest.current[workspace]);
      const next = saveStudioWorkspace(studioStorage(), workspace, panels, latest.current);
      latest.current = next;
      setLayouts(next);
    },
    [workspace],
  );
  const reset = useCallback(() => change(() => defaultStudioLayouts(defaults.current)[workspace]), [change, workspace]);
  return { workspace, selectWorkspace, panels: layouts[workspace], change, reset };
}
