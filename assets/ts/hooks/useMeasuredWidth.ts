import { useEffect, useRef, useState } from "preact/hooks";

/** Width of the element, kept current as its container changes. Null until measurable. */
export function useMeasuredWidth() {
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const measure = () => setWidth(target.clientWidth || null);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return { element, width };
}
