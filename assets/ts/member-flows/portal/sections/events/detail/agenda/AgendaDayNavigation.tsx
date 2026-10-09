import { AgendaDayLabel } from "../../../../../../site/AgendaDayLabel";
import { TabList } from "../../../../../../ui/TabList";
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
    <TabList
      class="pk-content-agenda__tabs"
      label="Agenda days"
      idPrefix="agenda-tab"
      activeId={activeDate ?? days[0]?.date ?? ""}
      onSelect={onSelect}
      items={days.map(({ date }) => ({
        id: date,
        label: <AgendaDayLabel date={date} />,
        panelId: `agenda-day-${date}`,
      }))}
    />
  );
}
