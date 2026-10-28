import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";

/** Keep an authored-content toolbar below visible chrome in either the page or a nested scroll surface. */
export function useStickyToolbar(rootRef: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scope = root.closest("dialog[open]") ?? document;
    const headers = [
      ...scope.querySelectorAll<HTMLElement>('header, nav, [role="banner"], [data-sticky-header]'),
    ].filter((element) => !root.contains(element));
    let scrollSurface = root.parentElement;
    while (
      scrollSurface &&
      scrollSurface !== document.body &&
      !/(auto|scroll|overlay)/.test(getComputedStyle(scrollSurface).overflowY)
    )
      scrollSurface = scrollSurface.parentElement;
    if (scrollSurface === document.body) scrollSurface = null;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = root.getBoundingClientRect();
      const base = scrollSurface?.getBoundingClientRect().top ?? 0;
      let top = Math.max(base, window.visualViewport?.offsetTop ?? 0);
      const pinned = headers.flatMap((element) => {
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        return ["sticky", "fixed"].includes(style.position) &&
          rect.height > 0 &&
          rect.right >= (bounds.left + bounds.right) / 2 &&
          rect.left <= (bounds.left + bounds.right) / 2
          ? [rect]
          : [];
      });
      for (let pass = 0; pass < pinned.length; pass++) {
        const next = pinned.reduce(
          (offset, rect) => (rect.top <= offset + 1 && rect.bottom > offset ? rect.bottom : offset),
          top,
        );
        if (next === top) break;
        top = next;
      }
      root.style.setProperty("--pk-editor-sticky-top", `${Math.max(0, top - base)}px`);
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queue);
    observer?.observe(root);
    for (const header of headers) observer?.observe(header);
    window.addEventListener("resize", queue);
    window.addEventListener("scroll", queue, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", queue);
    viewport?.addEventListener("scroll", queue);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", queue);
      window.removeEventListener("scroll", queue, true);
      viewport?.removeEventListener("resize", queue);
      viewport?.removeEventListener("scroll", queue);
      root.style.removeProperty("--pk-editor-sticky-top");
    };
  }, [rootRef]);
}
