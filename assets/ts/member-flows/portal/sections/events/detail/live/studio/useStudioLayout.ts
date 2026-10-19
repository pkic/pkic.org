import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import {
  STUDIO_LAYOUT_STORAGE_KEY,
  STUDIO_WORKSPACES,
  defaultStudioLayouts,
  loadStudioLayouts,
  saveStudioWorkspace,
  studioStorage,
  type StudioLayouts,
  type StudioPanel,
} from "./studio-layout";

export type StudioChange = (update: (panels: readonly StudioPanel[]) => StudioPanel[]) => void;

/**
 * The workspace in view follows the address, so a bookmark opens the same
 * workspace; its panel arrangement is the operator's own and stays in their
 * browser. A change saves only the workspace it changed, on top of what the
 * browser holds now, so a second studio tab never writes its older sizes
 * over this one's; and a change saved in another tab shows here too.
 */
export function useStudioLayout() {
  const [workspace, selectWorkspace] = useHashQueryParam("studio", "show", STUDIO_WORKSPACES);
  const [layouts, setLayouts] = useState<StudioLayouts>(() => loadStudioLayouts(studioStorage()));
  const latest = useRef(layouts);
  latest.current = layouts;
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== STUDIO_LAYOUT_STORAGE_KEY) return;
      const next = loadStudioLayouts(studioStorage());
      latest.current = next;
      setLayouts(next);
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);
  const change = useCallback<StudioChange>(
    (update) => {
      const panels = update(latest.current[workspace]);
      const next = saveStudioWorkspace(studioStorage(), workspace, panels, latest.current);
      latest.current = next;
      setLayouts(next);
    },
    [workspace],
  );
  const reset = useCallback(() => change(() => defaultStudioLayouts()[workspace]), [change, workspace]);
  return { workspace, selectWorkspace, panels: layouts[workspace], change, reset };
}
