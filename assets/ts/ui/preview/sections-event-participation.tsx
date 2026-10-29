import type { PreviewSection } from "./PreviewShell";
import { EventCard } from "../../site/EventCard";
import { DayAttendancePicker } from "../../components/DayAttendancePicker";
import { eventDayReadModelSchema } from "../../../shared/schemas/event-read-models";
import "../../../design/tokens.public.generated.css";
import "../../member-flows/portal/sections/DiscoveryView.css";

export const eventParticipationSections: PreviewSection[] = [
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
    note: "Choose an attendance method or Not attending for each day.",
    render: () => (
      <DayAttendancePicker
        days={[1, 2, 3].map((number) =>
          eventDayReadModelSchema.parse({
            dayDate: `2026-12-0${number}`,
            label: `December ${number}, 2026`,
            inPersonCapacity: null,
            sortOrder: number,
            attendanceOptions: [
              { value: "in_person", label: "In person" },
              { value: "virtual", label: "Virtual" },
              { value: "on_demand", label: "On demand" },
              { value: "lounge", label: "Livestream Lounge", icon: "people" },
            ],
          }),
        )}
      />
    ),
  },
];
