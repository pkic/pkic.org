/**
 * One bar for a whole made of named parts: how much of a total each part
 * filled, side by side, with the unfilled rest as the track.
 *
 * The parts carry no legend on the page. Pointing at a part names it through
 * the native tooltip (the SVG `title`), the same tooltip convention as
 * icon-only controls; a screen reader gets the parts as a list instead. The
 * bar stays one line however many parts there are, which is why it replaces a
 * meter per part where the parts can grow without bound.
 */
import "./SegmentedBar.css";

export interface BarSegment {
  key: string;
  /** What the part is, as the tooltip and the screen-reader list say it. */
  label: string;
  value: number;
}

export function SegmentedBar({
  label,
  segments,
  total,
}: {
  /** The whole, stated once: "33 of 49 meetings attended". */
  label: string;
  segments: readonly BarSegment[];
  total: number;
}) {
  if (total <= 0) return null;
  let offset = 0;
  return (
    <div>
      <svg
        class="pk-segmented-bar__track"
        viewBox={`0 0 ${String(total)} 1`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {segments.map((segment) => {
          const x = offset;
          offset += segment.value;
          return segment.value > 0 ? (
            <rect key={segment.key} class="pk-segmented-bar__part" x={x} y={0} width={segment.value} height={1}>
              <title>{segment.label}</title>
            </rect>
          ) : null;
        })}
      </svg>
      <p class="pk-sr-only">{label}</p>
      <ul class="pk-sr-only">
        {segments.map((segment) => (
          <li key={segment.key}>{segment.label}</li>
        ))}
      </ul>
    </div>
  );
}
