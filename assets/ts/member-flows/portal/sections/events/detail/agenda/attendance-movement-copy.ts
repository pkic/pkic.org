/** Organizer-facing words for self check-in records, attribution and movement. */
import type { AttendeeStanding } from "../../../../../../../shared/attendance-points";
import { formatNumber } from "../../../../../../../shared/format-number";
import type {
  selfCheckInBookingSchema,
  selfCheckInExpectationSchema,
} from "../../../../../../../shared/schemas/event-attendance-movement";
import type { z } from "zod";

export const ATTENDEE_STANDING_LABELS: Record<AttendeeStanding, string> = {
  in_person: "In person",
  remote: "Online",
  not_registered: "Not registered",
  no_in_person_place: "No in-person place",
};

const option = <Value extends string>(labels: Record<Value, string>) =>
  (Object.entries(labels) as [Value, string][]).map(([value, label]) => ({ value, label }));

export const STANDING_FILTER = [{ value: "", label: "Any registration" }, ...option(ATTENDEE_STANDING_LABELS)];
const BOOKING_LABELS: Record<z.infer<typeof selfCheckInBookingSchema>, string> = {
  booked: "Booked",
  not_booked: "Not booked",
};
const EXPECTATION_LABELS: Record<z.infer<typeof selfCheckInExpectationSchema>, string> = {
  no: "Not registered or booked",
  yes: "Registered and booked",
};

export const BOOKING_FILTER = [{ value: "", label: "Any seat" }, ...option(BOOKING_LABELS)];
export const EXPECTED_FILTER = [{ value: "", label: "Everyone" }, ...option(EXPECTATION_LABELS)];

/** "half of the session", "75% of the session": the share a stay must cover to count. */
export function formatMinimumStay(percent: number | null): string {
  if (percent === null) return "the event's minimum share of the session";
  if (percent === 50) return "half of the session";
  if (percent === 100) return "the whole session";
  return `${formatNumber(percent)}% of the session`;
}
