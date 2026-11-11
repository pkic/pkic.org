import { svgSparkline } from "./chart";

/** A word-sized trend with its numbers for assistive technology; see `svgSparkline`. */
export function Sparkline(props: { values: readonly (number | null)[] } & Parameters<typeof svgSparkline>[1]) {
  const { values, ...options } = props;
  return <div class="pk-sparkline" dangerouslySetInnerHTML={{ __html: svgSparkline(values, options) }} />;
}
