import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { formatDayList } from "../../../shared/format-date";
import { confirmAction } from "../ConfirmDialog";
import { releasedRegistrationDays, type RegistrationDayChoices } from "./registration-day-changes";

/** The same seat-release decision for the day picker and the full registration editor. */
export async function confirmRegistrationDayChanges(
  data: RegistrationManageReadResponse,
  next: RegistrationDayChoices,
): Promise<boolean> {
  const days = releasedRegistrationDays(data, next);
  // Giving up every day goes through the caller's cancellation confirmation.
  if (!next.length || !days.length) return true;
  return confirmAction({
    title: `Release your seat on ${formatDayList(
      days.map((day) => day.dayDate),
      { includeDates: true },
    )}?`,
    body: "Your seat goes to the next person on the waiting list. If you change your mind later, you join the waiting list again.",
    confirmLabel: "Release seats and save",
    cancelLabel: "Keep editing",
  });
}
