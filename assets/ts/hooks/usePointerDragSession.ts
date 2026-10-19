import type { MutableRef } from "preact/hooks";
import { useEffect, useRef } from "preact/hooks";

/** What every pointer drag tracks: the pointer that owns it, whether it has begun, and its pending frame. */
export interface PointerDragState {
  pointer: number;
  started: boolean;
  frame: number | null;
}

/**
 * The parts of a pointer drag every surface shares (the studio grid, the
 * overlay layout canvas): releasing the pointer commits, a cancelled pointer
 * or Escape puts everything back, unmounting abandons the drag, and pointer
 * moves are coalesced into one animation frame.
 */
export function usePointerDragSession<State extends PointerDragState>(
  gesture: MutableRef<State | null>,
  finish: (commit: boolean) => void,
) {
  const end = useRef(finish);
  end.current = finish;

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current?.started) {
        event.preventDefault();
        end.current(false);
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      end.current(false);
    };
  }, []);

  return {
    release: (event: PointerEvent) => {
      if (gesture.current?.pointer === event.pointerId) end.current(true);
    },
    cancel: (event: PointerEvent) => {
      if (gesture.current?.pointer === event.pointerId) end.current(false);
    },
    /** Asks for the drag's next frame unless one is pending; `frame` must clear `active.frame` when it runs. */
    requestFrame: (active: State, frame: () => void) => {
      if (active.frame !== null) return;
      // A frame that runs at once (as in a test) has already cleared its slot; keep it clear.
      active.frame = -1;
      const id = requestAnimationFrame(frame);
      if (active.frame === -1) active.frame = id;
    },
  };
}
