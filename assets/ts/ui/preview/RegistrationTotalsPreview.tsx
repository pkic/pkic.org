import { useState } from "preact/hooks";
import { RegistrationTotals } from "../../components/event-registrations/RegistrationTotals";
import type { EventAttendanceRegistrationsStats } from "../../../shared/schemas/event-registrations";
import type { EventAttendanceOption } from "../../../shared/schemas/event-configuration";

const STATS: EventAttendanceRegistrationsStats = {
  byAttendanceType: {},
  attendanceStatusByType: {
    in_person: { total: 1268, accepted: 912, waitlisted: 356, expired: 0, pending: 0, cancelled: 41 },
    virtual: { total: 1388, accepted: 1388, waitlisted: 0, expired: 0, pending: 1, cancelled: 143 },
    livestream_lounge: { total: 86, accepted: 86, waitlisted: 0, expired: 0, pending: 0, cancelled: 2 },
  },
  byStatus: { registered: 3344, pending_email_confirmation: 1, cancelled: 184 },
  waitlistedCount: 356,
};

/** A custom option with the icon its settings chose, beside the built-in two. */
const OPTIONS: EventAttendanceOption[] = [
  { value: "in_person", label: "In-person" },
  { value: "virtual", label: "Virtual" },
  { value: "livestream_lounge", label: "Livestream Lounge", icon: "people" },
];

/** The registration totals as a list's filters, with the In-person waitlist applied. */
export function RegistrationTotalsPreview() {
  const [current, setCurrent] = useState<Record<string, string>>({
    attendance_type: "in_person",
    status: "registered,pending_email_confirmation",
    waitlisted: "true",
  });
  return (
    <RegistrationTotals
      stats={STATS}
      attendanceOptions={OPTIONS}
      filters={{
        current,
        apply: (changes) =>
          setCurrent((previous) =>
            Object.fromEntries(Object.entries({ ...previous, ...changes }).filter(([, value]) => value)),
          ),
        byAttendanceType: true,
      }}
    />
  );
}
