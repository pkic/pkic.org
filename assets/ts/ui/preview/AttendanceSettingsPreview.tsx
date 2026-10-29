import { eventDaysManagementResponseSchema } from "../../../shared/schemas/event-configuration";
import { EventDaysView } from "../../member-flows/portal/sections/management/EventDaysView";
import { EventDaysForm } from "../../member-flows/portal/sections/management/EventDaysForm";

const response = eventDaysManagementResponseSchema.parse({
  eventUpdatedAt: "2027-08-01T00:00:00.000Z",
  days: Array.from({ length: 3 }, (_, index) => ({
    id: `preview-day-${index + 1}`,
    date: `2026-12-0${index + 1}`,
    label: "",
    startsAt: `2026-12-0${index + 1}T08:00:00.000Z`,
    endsAt: `2026-12-0${index + 1}T16:00:00.000Z`,
    sortOrder: index * 10,
    attendanceOptions: [
      { value: "in_person", label: "In person", description: "At the venue", capacity: [1, 25, 50][index] },
      { value: "virtual", label: "Virtual", description: "Live stream in the event portal" },
      { value: "on_demand", label: "On demand", description: "Recordings after each day" },
      {
        value: "lounge",
        label: "Livestream Lounge",
        description: "Watch together at a partner venue",
        icon: "video_people",
        capacity: 100,
        enabled: index !== 2,
      },
    ],
    attendanceCounts: {
      in_person: [1, 19, 12][index],
      virtual: [212, 188, 143][index],
      on_demand: [40, 31, 27][index],
      lounge: [64, 58, 0][index],
    },
  })),
});

export function AttendanceSettingsPreview({ readOnly = false }: { readOnly?: boolean }) {
  if (readOnly) return <EventDaysView response={response} zone="Europe/Amsterdam" />;
  return (
    <EventDaysForm
      endpoint="/api/v1/events/preview/days"
      event={{ timezone: "Europe/Amsterdam" }}
      response={response}
      expectedUpdatedAt={response.eventUpdatedAt}
      onRevision={() => {}}
      onCancel={async () => {}}
      onSaved={async () => {}}
    />
  );
}
