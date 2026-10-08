import { formatNumber } from "../../../../../../../shared/format-number";
import { PARTICIPATION_AVAILABILITY_LABELS } from "../../../../../../../shared/event-participation-availability";
import type { z } from "zod";
import type { personalAgendaSessionSchema } from "../../../../../../../shared/schemas/event-personal-agenda";
const STATUS_LABELS = {
  saved: "Saved preference",
  reserved: "Reserved",
  approval_pending: "Awaiting approval",
  waitlisted: "Waitlisted",
  canceled: "Canceled",
};
export function PersonalAgendaStatus({ session }: { session: z.infer<typeof personalAgendaSessionSchema> }) {
  const states = [...new Set(session.availability.map((item) => PARTICIPATION_AVAILABILITY_LABELS[item.state]))];
  return (
    <div class="pk-stack">
      <span>{session.status ? STATUS_LABELS[session.status] : "Not saved"}</span>
      {states.length > 0 && <small>{states.join(" · ")}</small>}
      {session.saved && session.status !== "saved" && <small>Saved preference</small>}
      {session.overlapCount > 0 && (
        <div role="note" class="pk-muted">
          <strong>Overlaps with your agenda</strong>
          <ul>
            {session.overlaps.map((other) => (
              <li key={other.id}>
                {other.title} — {STATUS_LABELS[other.status]}
              </li>
            ))}
          </ul>
          {session.overlapCount > session.overlaps.length && (
            <p>And {formatNumber(session.overlapCount - session.overlaps.length)} more.</p>
          )}
          <small>You can keep overlapping preferences. A confirmed reservation requires choosing one session.</small>
        </div>
      )}
    </div>
  );
}
