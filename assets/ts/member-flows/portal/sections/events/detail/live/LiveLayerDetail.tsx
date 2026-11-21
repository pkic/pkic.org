import { liveLayerUnseenLine } from "./live-layer-unseen";
import { liveLayerTargets, type LiveLayer, type LiveTargets } from "./live-output-targets";
import "./LiveLayerDetail.css";

/** Why nobody sees the graphic where an output holds it, for its row, or null while it shows wherever it is held. */
export const liveLayerUnseenOf = (outputs?: { targets: LiveTargets; layer: LiveLayer }) =>
  outputs ? liveLayerUnseenLine(liveLayerTargets(outputs.targets, outputs.layer)) : null;

/**
 * A graphic row's summary line: what it shows, led by why nobody sees it
 * where it is held, such as "On air · covered by Question". Plain words in
 * the warning ink, only while that is so.
 */
export function LiveLayerDetail({
  class: className,
  detail,
  unseen,
}: {
  class: string;
  detail: string;
  unseen: string | null;
}) {
  return (
    <span class={className} title={[unseen, detail].filter(Boolean).join(" · ")}>
      {unseen ? <span class="pk-live-unseen">{unseen}</span> : null}
      {unseen && detail ? " · " : null}
      {detail}
    </span>
  );
}
