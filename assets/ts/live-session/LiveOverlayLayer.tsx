import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { liveOverlayLayerTransform, type OverlayRect } from "../../shared/live-overlay-geometry";
import { LIVE_OVERLAY_FRAME } from "../../shared/schemas/live-overlay-layout";
import type { LiveOverlayElement, LiveOverlayElementPlacement } from "../../shared/schemas/live-overlay-layout";

const FULL_FRAME: OverlayRect = { x: 0, y: 0, width: LIVE_OVERLAY_FRAME.width, height: LIVE_OVERLAY_FRAME.height };

/**
 * One element of the overlay in its layout box. The graphic is drawn at its
 * standard broadcast size on the 1920 × 1080 frame, measured, then moved and
 * scaled whole into the box at the box's anchor. A graphic that already fills
 * its box exactly is left untransformed, so a full-frame layout draws as it
 * always has.
 */
export function LiveOverlayLayer({
  element,
  placement,
  dimmed = false,
  children,
}: {
  element: LiveOverlayElement;
  /** Drawn faintly, behind the element the layout editor has selected. */
  dimmed?: boolean;
  placement: LiveOverlayElementPlacement;
  children: ComponentChildren;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<OverlayRect>(FULL_FRAME);
  useLayoutEffect(() => {
    const read = () => {
      const shell = surface.current?.firstElementChild;
      if (!(shell instanceof HTMLElement)) return;
      // A positioning shell (the question's or poll's frame) is measured by the card it holds, so the card fills its box.
      const card = shell.dataset.overlayShell !== undefined ? shell.firstElementChild : null;
      const node = card instanceof HTMLElement ? card : shell;
      if (!node.offsetWidth || !node.offsetHeight) return;
      const next = {
        x: node.offsetLeft + (node === shell ? 0 : shell.offsetLeft),
        y: node.offsetTop + (node === shell ? 0 : shell.offsetTop),
        width: node.offsetWidth,
        height: node.offsetHeight,
      };
      setBounds((current) =>
        (Object.keys(next) as Array<keyof OverlayRect>).every((key) => current[key] === next[key]) ? current : next,
      );
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    if (surface.current) observer.observe(surface.current);
    const shell = surface.current?.firstElementChild;
    if (shell) observer.observe(shell);
    if (shell?.firstElementChild) observer.observe(shell.firstElementChild);
    return () => observer.disconnect();
  }, [children]);
  const transform = liveOverlayLayerTransform(placement, bounds);
  // The move and scale are measured, so they reach the stylesheet as custom properties rather than markup.
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    for (const [name, value] of [
      ["--overlay-dx", `${transform.dx}px`],
      ["--overlay-dy", `${transform.dy}px`],
      ["--overlay-scale", String(transform.scale)],
    ])
      node.style.setProperty(name, value);
  }, [transform.dx, transform.dy, transform.scale]);
  return (
    <div class="pk-live-overlay__layer" data-overlay-element={element} data-dimmed={dimmed ? "" : undefined}>
      <div ref={surface} class="pk-live-overlay__surface" data-placed={transform.identity ? undefined : ""}>
        {children}
      </div>
    </div>
  );
}
