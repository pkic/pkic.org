import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * Marks a scrolling box with which of its edges have more content past them
 * (`data-more="above below"`), so its stylesheet can fade those edges and
 * show the scrollbar: content that does not fit is never cut off without a
 * sign that more follows. It writes the attribute directly, so scrolling
 * never renders the box again.
 */
export function useScrollEdges<Element extends HTMLElement>() {
  const ref = useRef<Element>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const edges = [
        node.scrollTop > 1 ? "above" : null,
        node.scrollTop + node.clientHeight < node.scrollHeight - 1 ? "below" : null,
      ].filter(Boolean);
      if (edges.length) node.setAttribute("data-more", edges.join(" "));
      else node.removeAttribute("data-more");
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    for (const child of node.children) observer?.observe(child);
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    mutations?.observe(node, { childList: true, subtree: true });
    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
      mutations?.disconnect();
    };
  }, []);
  return ref;
}
