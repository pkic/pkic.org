import { LIVE_STUDIO_AUX_OUTPUTS, type LiveAuxOutput } from "../../../../../../../shared/live-room-outputs";
import "./live-tally.css";
import "./LiveTallyBands.css";

/** Where a graphic is now, as the output controls read it. */
export interface LiveTallyWhere {
  preview: boolean;
  program: boolean;
  aux: (output: LiveAuxOutput) => boolean;
}

/**
 * A thin band in each output's color on the leading edge of a studio row,
 * one per output the graphic is on: Program first, then Preview and the
 * room's screens. The row's output buttons say the same in words.
 */
export function LiveTallyBands({ where }: { where: LiveTallyWhere }) {
  const on = [
    ...(where.program ? (["program"] as const) : []),
    ...(where.preview ? (["preview"] as const) : []),
    ...LIVE_STUDIO_AUX_OUTPUTS.filter((output) => where.aux(output)),
  ];
  if (!on.length) return null;
  return (
    <span class="pk-live-tally-bands" aria-hidden="true">
      {on.map((output) => (
        <span key={output} data-tally={output} />
      ))}
    </span>
  );
}
