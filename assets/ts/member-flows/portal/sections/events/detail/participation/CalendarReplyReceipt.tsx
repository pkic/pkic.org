import type { z } from "zod";
import type { sessionBookingRowSchema } from "../../../../../../../shared/schemas/event-participation-reporting";
import { Badge } from "../../../../../../ui/Badge";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { StatusBadge } from "../../../../../../site/StatusBadge";
import { LocalTime } from "../../../../../../site/SiteDate";
type Participant = z.infer<typeof sessionBookingRowSchema>;
const receipts = {
  applied: { label: "Reply applied", tone: "ok" },
  tentative: { label: "Tentative reply", tone: "info" },
  needs_review: { label: "Reply needs review", tone: "warn" },
  rejected: { label: "Reply rejected", tone: "warn" },
} as const;
export function CalendarReplyBadge({ participant }: { participant: Participant }) {
  const state = participant.calendarReplyDisposition;
  return state ? (
    <Badge tone={receipts[state].tone}>{receipts[state].label}</Badge>
  ) : (
    <span class="pk-muted">No reply received</span>
  );
}
/** Only the bounded receipt is displayed; message bodies and sender addresses are never fetched. */
export function CalendarReplyReceipt({ participant }: { participant: Participant }) {
  return (
    <div class="pk-stack">
      <DescriptionList
        items={[
          { term: "Latest calendar reply", value: <CalendarReplyBadge participant={participant} /> },
          {
            term: "Response",
            value: participant.calendarReplyResponse ? (
              <StatusBadge status={participant.calendarReplyResponse} />
            ) : undefined,
          },
          {
            term: "Received",
            value: participant.calendarReplyReceivedAt ? (
              <LocalTime value={participant.calendarReplyReceivedAt} format="date-time" />
            ) : undefined,
          },
        ]}
      />
      {participant.calendarReplyDisposition === "needs_review" && (
        <p class="pk-muted">
          This calendar reply could not be applied automatically. Review the participant’s registration before changing
          it.
        </p>
      )}
    </div>
  );
}
