import { AppError } from "../errors";
export function isEventDayCapacityConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("EVENT_DAY_CAPACITY_CHANGED");
}
export function eventDayCapacityChangedError(message = "Day capacity changed; please retry"): AppError {
  return new AppError(409, "DAY_CAPACITY_CHANGED", message);
}
