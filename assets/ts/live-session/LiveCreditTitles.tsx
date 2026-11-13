import { liveCreditAffiliations } from "../../shared/live-room-credits";
import type { LiveCredit } from "../../shared/schemas/live-session-room";
import { AgendaAffiliationRotation } from "../site/AgendaSpeakerAffiliations";
import "./LiveCreditTitles.css";

/**
 * A person's title line on a stream graphic: their identity, or each of several in turn, rolling up to
 * the next. The caller's title box clips the roll.
 */
export function LiveCreditTitles({ credit }: { credit: Pick<LiveCredit, "identity" | "additionalIdentities"> }) {
  const lines = liveCreditAffiliations(credit);
  if (lines.length < 2) return <span>{lines[0] ?? ""}</span>;
  return (
    <span class="pk-live-credit-titles">
      <AgendaAffiliationRotation labels={lines}>
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </AgendaAffiliationRotation>
    </span>
  );
}
