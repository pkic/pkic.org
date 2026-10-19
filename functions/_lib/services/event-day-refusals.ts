/**
 * The refusals of a change to the days a registration holds. Each carries a
 * stable code for the browser and a sentence for the person who asked: the
 * day by its own name, the attendance method by the organizer's label, and
 * what to do next. A day is named by its label when it has one, and by its
 * calendar date otherwise; the server does not localize dates.
 */
import { AppError } from "../errors";

interface NamedDay {
  day_date: string;
  label: string | null;
}

function dayName(day: NamedDay): string {
  return day.label?.trim() || day.day_date;
}

/** A configured option label, or the value itself made readable ("on_demand" → "on-demand"). */
export function attendanceMethodName(value: string, label?: string | null): string {
  const readable = label?.trim() || value.replaceAll("_", "-");
  return readable.toLowerCase();
}

export function dayNotConfiguredError(dayDate: string): AppError {
  return new AppError(
    400,
    "DAY_NOT_CONFIGURED",
    `${dayDate} is not a day of this event. Reload the page and choose from the event's days.`,
  );
}

export function dayAttendanceTypeNotConfiguredError(day: NamedDay, method: string): AppError {
  return new AppError(
    400,
    "DAY_ATTENDANCE_TYPE_NOT_CONFIGURED",
    `${dayName(day)} does not offer ${method} attendance. Choose another way to attend that day.`,
  );
}

export function waitlistRequiresInPersonError(day: NamedDay): AppError {
  return new AppError(
    400,
    "WAITLIST_REQUIRES_IN_PERSON",
    `Only in-person attendance has a waitlist. Choose in-person for ${dayName(day)} first.`,
  );
}

export function dayCapacityUnlimitedError(day: NamedDay): AppError {
  return new AppError(
    409,
    "DAY_CAPACITY_UNLIMITED",
    `${dayName(day)} has no seat limit, so there is no waitlist to join.`,
  );
}

export function dayAttendanceRequiredError(): AppError {
  return new AppError(400, "DAY_ATTENDANCE_REQUIRED", "Choose how you attend each day of this event.");
}

export function registrationCancelledDayChangeError(): AppError {
  return new AppError(
    409,
    "REGISTRATION_CANCELLED",
    "This registration is cancelled. Restore it before changing its days.",
  );
}
