import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

/**
 * Keeps a mounted agenda's filters in step with its props: moving to another location opens the agenda on
 * that one (the first is applied as the agenda starts), and a personal agenda's marks change in place, so an
 * active My agenda filter re-evaluates the cards on every render.
 */
export function useAgendaFilterRefresh(
  root: RefObject<HTMLElement>,
  { focusLocation, personal }: { focusLocation?: string; personal: boolean },
): void {
  const focused = useRef(focusLocation);
  useEffect(() => {
    if (focused.current === focusLocation) return;
    focused.current = focusLocation;
    void import("./agenda-filters").then(({ showDefaultLocations, refreshAgendaFilters }) => {
      if (!root.current) return;
      showDefaultLocations(root.current);
      refreshAgendaFilters(root.current);
    });
  }, [root, focusLocation]);
  useEffect(() => {
    if (!personal) return;
    void import("./agenda-filters").then(({ refreshAgendaFilters }) => {
      if (root.current) refreshAgendaFilters(root.current);
    });
  });
}
