import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/**
 * Renders only the rows of a scrolling list that are in view, plus a margin,
 * so a long feed keeps a small DOM. Rows may differ in height: each is
 * measured once it renders and estimated until then. Before the list has a
 * height (not laid out yet, or in a test document) it renders the last rows.
 */
export function useWindowedList<Item>(
  items: readonly Item[],
  key: (item: Item) => string,
  options: { estimate: number; overscan: number; initial: number },
) {
  const viewport = useRef<HTMLElement | null>(null);
  const heights = useRef(new Map<string, number>());
  const [frame, setFrame] = useState({ top: 0, height: 0 });
  const [, setMeasured] = useState(0);
  const pending = useRef<number | null>(null);

  const read = useCallback(() => {
    pending.current = null;
    const node = viewport.current;
    if (node) setFrame({ top: node.scrollTop, height: node.clientHeight });
  }, []);
  const onScroll = useCallback(() => {
    pending.current ??= requestAnimationFrame(read);
  }, [read]);

  useEffect(() => {
    const node = viewport.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => read());
    observer.observe(node);
    return () => observer.disconnect();
  }, [read]);
  useEffect(
    () => () => {
      if (pending.current !== null) cancelAnimationFrame(pending.current);
    },
    [],
  );

  const offsets = [0];
  for (const item of items) offsets.push(offsets.at(-1)! + (heights.current.get(key(item)) ?? options.estimate));
  let start: number;
  let end: number;
  if (frame.height === 0) {
    start = Math.max(0, items.length - options.initial);
    end = items.length;
  } else {
    const from = frame.top - options.overscan;
    const to = frame.top + frame.height + options.overscan;
    start = Math.max(0, offsets.findIndex((offset, index) => index > 0 && offset > from) - 1);
    end = offsets.findIndex((offset) => offset >= to);
    if (end < 0) end = items.length;
    end = Math.min(items.length, Math.max(end, start + 1));
  }

  /** A ref for one rendered row; a changed height re-renders the window once. */
  const measure = useCallback(
    (id: string) => (node: HTMLElement | null) => {
      if (!node) return;
      const height = node.getBoundingClientRect().height;
      if (height > 0 && Math.abs((heights.current.get(id) ?? 0) - height) > 0.5) {
        heights.current.set(id, height);
        setMeasured((count) => count + 1);
      }
    },
    [],
  );

  return {
    viewport,
    onScroll,
    measure,
    start,
    rows: items.slice(start, end),
    /** The space the rows before and after the window would take. */
    before: offsets[start],
    after: offsets[items.length] - offsets[end],
  };
}
