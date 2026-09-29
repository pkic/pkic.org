import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { svgStackedBarChart } from "./chart";

type ChartOptions = Parameters<typeof svgStackedBarChart>[2];

/** Recompute plot geometry at the panel width so labels never scale with it. */
export function StackedBarChart({
  labels,
  series,
  ...options
}: ChartOptions & {
  labels: string[];
  series: Parameters<typeof svgStackedBarChart>[1];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(460);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  return (
    <div
      ref={host}
      class="pk-chart-wide"
      dangerouslySetInnerHTML={{ __html: svgStackedBarChart(labels, series, { ...options, width }) }}
    />
  );
}
