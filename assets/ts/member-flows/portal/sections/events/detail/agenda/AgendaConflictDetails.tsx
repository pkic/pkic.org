import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { formatCalendarDate, formatTimeRangeInZone } from "../../../../../../../shared/format-date";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import type { agendaConflictDetails } from "./agenda-conflict-details";

export function AgendaConflictDetails({
  details,
  snapshot,
}: {
  details: NonNullable<ReturnType<typeof agendaConflictDetails>>;
  snapshot: AgendaSnapshot;
}) {
  const proposal = details.proposal;
  return (
    <section aria-label="Schedule conflict details" class="pk-stack">
      <ul>
        {details.conflicts.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
      {proposal && (
        <>
          <p>
            Requested changes · {proposal.timeZone}. These are the attempted sessions; not every session necessarily
            caused the refusal.
          </p>
          <ul>
            {proposal.occurrences.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {" · "}
                {item.startAt ? (
                  <>
                    {formatCalendarDate(instantToDateTimeLocal(item.startAt, proposal.timeZone).slice(0, 10))}
                    {" · "}
                    {formatTimeRangeInZone(item.startAt, item.endAt ?? undefined, proposal.timeZone)}
                  </>
                ) : (
                  "Unscheduled"
                )}
                {" · "}
                {[item.roomId, ...(item.additionalRoomIds ?? [])]
                  .filter((id) => id !== null)
                  .map((id) => snapshot.rooms.find((room) => room.id === id)?.name ?? "Location unavailable")
                  .join(" / ") || "No location"}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>Your changes have been kept. Adjust the requested times or locations and retry.</p>
    </section>
  );
}
