import "./live-tally.css";
import "./LiveTallyBands.css";

/** Whether a graphic is in Preview and on Program now. */
export interface LiveTallyWhere {
  preview: boolean;
  program: boolean;
}

/**
 * The leading edge of a studio row in the color of where the graphic is:
 * Program red while it is on air, on Preview as well or not, and Preview
 * green only while it is in Preview alone. The room's screens show as their
 * codes beside PVW and PGM instead.
 */
export function LiveTallyBands({ where }: { where: LiveTallyWhere }) {
  const on = where.program ? "program" : where.preview ? "preview" : null;
  if (!on) return null;
  return (
    <span class="pk-live-tally-bands" aria-hidden="true">
      <span data-tally={on} />
    </span>
  );
}
