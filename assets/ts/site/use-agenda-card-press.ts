import type { JSX } from "preact";
import { useRef } from "preact/hooks";

/** Opens a card on a pointer tap while leaving controls, selection, and dragging alone. */
export function useAgendaCardPress(open?: () => void) {
  const press = useRef<{ pointer: number; target: EventTarget; x: number; y: number } | null>(null);
  const cancel = () => {
    press.current = null;
  };
  return {
    cancel,
    onPointerDown(event: JSX.TargetedPointerEvent<HTMLElement>) {
      const target = event.target;
      cancel();
      if (
        !open ||
        !event.isPrimary ||
        event.button !== 0 ||
        !(target instanceof Element) ||
        target.closest("a, button, input, select, textarea, label, summary, dialog, [data-agenda-card-control]")
      )
        return;
      press.current = { pointer: event.pointerId, target, x: event.clientX, y: event.clientY };
    },
    onPointerMove(event: JSX.TargetedPointerEvent<HTMLElement>) {
      const current = press.current;
      if (
        current &&
        current.pointer === event.pointerId &&
        Math.hypot(event.clientX - current.x, event.clientY - current.y) > 5
      )
        cancel();
    },
    onPointerCancel: cancel,
    onPointerUp(event: JSX.TargetedPointerEvent<HTMLElement>) {
      const current = press.current;
      cancel();
      if (
        !open ||
        !current ||
        current.pointer !== event.pointerId ||
        current.target !== event.target ||
        Math.hypot(event.clientX - current.x, event.clientY - current.y) > 5 ||
        window.getSelection()?.toString()
      )
        return;
      open();
    },
  };
}
