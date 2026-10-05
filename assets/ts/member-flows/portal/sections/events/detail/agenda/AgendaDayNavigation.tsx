import { formatCalendarDate } from "../../../../../../../shared/format-date";
import { Button } from "../../../../../../ui/Button";
export function AgendaDayNavigation({
  days,
  activeDate,
  onSelect,
}: {
  days: ReadonlyArray<{ date: string }>;
  activeDate?: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div class="pk-cluster" role="group" aria-label="Agenda days">
      {days.map(({ date }) => (
        <Button aria-pressed={activeDate === date} onClick={() => onSelect(date)}>
          {formatCalendarDate(date)}
        </Button>
      ))}
    </div>
  );
}
