import "./live-tally.css";
import "./LiveTallyBands.css";

/** Whether a graphic is in Preview and on Program now. */
export interface LiveTallyWhere {
  preview: boolean;
  program: boolean;
}

/**
 * The leading edge of a studio row in Program red or Preview green, both
 * side by side when the graphic is on both. The room's screens show as dots
 * on the row's menu instead.
 */
export function LiveTallyBands({ where }: { where: LiveTallyWhere }) {
  const on = [...(where.program ? (["program"] as const) : []), ...(where.preview ? (["preview"] as const) : [])];
  if (!on.length) return null;
  return (
    <span class="pk-live-tally-bands" aria-hidden="true">
      {on.map((output) => (
        <span key={output} data-tally={output} />
      ))}
    </span>
  );
}
