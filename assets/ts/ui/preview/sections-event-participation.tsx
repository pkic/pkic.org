import type { PreviewSection } from "./PreviewShell";
import { AttendanceSettingsPreview } from "./AttendanceSettingsPreview";
import { EventCard } from "../../site/EventCard";
import { DayAttendancePicker } from "../../components/DayAttendancePicker";
import { eventDayReadModelSchema } from "../../../shared/schemas/event-read-models";
import { ATTENDANCE_ICON_LABELS, type AttendanceIconName } from "../../../shared/event-attendance-icons";
import "../../../design/tokens.public.generated.css";
import "../../member-flows/portal/sections/DiscoveryView.css";

export const eventParticipationSections: PreviewSection[] = [
  {
    id: "attendance-settings-view",
    title: "Attendance settings view",
    render: () => <AttendanceSettingsPreview readOnly />,
  },
  { id: "attendance-settings", title: "Attendance settings", render: () => <AttendanceSettingsPreview /> },
  {
    id: "event-cards",
    title: "Event cards",
    note: "The same photo and gradient cards in public listings and portal discovery.",
    render: () => (
      <div class="pk-discovery-grid">
        {[false, true, false].map((photo, index) => (
          <EventCard
            key={index}
            heading={index === 0 ? "h2" : "h3"}
            upcoming
            item={{
              title: "Post-Quantum Cryptography Conference",
              href: "#event-cards",
              imageSrc: photo
                ? new URL(
                    "../../../../content/events/2026/pqc-conference-amsterdam-nl/amsterdam-nl.png",
                    import.meta.url,
                  ).href
                : undefined,
              location: "December 1–3, 2026 · Amsterdam, Netherlands",
            }}
          />
        ))}
      </div>
    ),
  },
  {
    id: "attendance-options",
    title: "Attendance options",
    render: () => <DayAttendancePicker days={attendanceDays(3)} />,
  },
  {
    id: "attendance-week",
    title: "Seven-day attendance",
    render: () => <DayAttendancePicker days={attendanceDays(7)} />,
  },
  {
    id: "attendance-full",
    title: "Two full days",
    render: () => <DayAttendancePicker days={attendanceDays(3, [0, 1])} />,
  },
  {
    id: "attendance-all-full",
    title: "All days full",
    render: () => <DayAttendancePicker days={attendanceDays(3, [0, 1, 2])} />,
  },
  {
    id: "attendance-icons",
    title: "Attendance icons",
    note: "Shared icons for livestream lounges, receptions, and networking breaks.",
    render: () => (
      <DayAttendancePicker
        days={[
          eventDayReadModelSchema.parse({
            dayDate: "2026-12-01",
            label: "December 1",
            inPersonCapacity: null,
            sortOrder: 0,
            attendanceOptions: (["video_location", "video_people", "cocktail", "coffee", "dining"] as const).map(
              (icon: AttendanceIconName) => ({ value: icon, label: ATTENDANCE_ICON_LABELS[icon], icon }),
            ),
          }),
        ]}
      />
    ),
  },
];

function attendanceDays(count: 3 | 7, fullIndices: readonly number[] = count === 3 ? [0] : [1, 2]) {
  return Array.from({ length: count }, (_, index) =>
    eventDayReadModelSchema.parse({
      dayDate: count === 7 ? (index === 0 ? "2026-11-30" : `2026-12-0${index}`) : `2026-12-0${index + 1}`,
      label: `Day ${index + 1}`,
      inPersonCapacity: null,
      sortOrder: index,
      attendanceOptions: [
        {
          value: "in_person",
          label: "In person",
          description: "At the venue",
          spotsRemainingPercent: fullIndices.includes(index) ? 0 : null,
        },
        { value: "virtual", label: "Virtual", description: "Live stream with Q&A" },
        { value: "on_demand", label: "On demand", description: "Recordings after each day" },
        ...(index < (count === 3 ? 2 : 5)
          ? [
              {
                value: "lounge",
                label: "Livestream Lounge",
                icon: "video_people",
                description: "Watch together at a partner venue",
              },
            ]
          : []),
      ],
    }),
  );
}
