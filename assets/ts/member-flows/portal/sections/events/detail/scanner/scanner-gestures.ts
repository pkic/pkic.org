export function scannerSwipeDirection(
  start: { x: number; y: number } | null,
  end: { x: number; y: number },
): "up" | "down" | null {
  if (!start) return null;
  const x = end.x - start.x,
    y = end.y - start.y;
  if (Math.abs(y) < 60 || Math.abs(y) < Math.abs(x) * 1.5) return null;
  return y < 0 ? "up" : "down";
}
export function trapScannerDrawerTab(container: HTMLElement, event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    container.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,[tabindex="0"]'),
  );
  const first = controls[0],
    last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
