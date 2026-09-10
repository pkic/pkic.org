import { useLayoutEffect, useRef } from "preact/hooks";

/** Keep the selected destination visible without scrolling the document. */
export function useActiveTabVisibility(activeId: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const reveal = () => {
      const active = list.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
      if (!active) return;
      const bounds = list.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
    };
    reveal();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeId]);
  return ref;
}
