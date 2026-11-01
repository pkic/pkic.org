import { z } from "zod";

/** Access to live sessions is configured independently of an attendance option's identifier. */
export const eventAttendanceAccessModeSchema = z.enum(["physical", "remote", "none"]);
export type EventAttendanceAccessMode = z.infer<typeof eventAttendanceAccessModeSchema>;

/** Legacy options retain their established behavior until an organizer configures a mode. */
export const LEGACY_ATTENDANCE_ACCESS: Readonly<Record<string, EventAttendanceAccessMode>> = {
  in_person: "physical",
  virtual: "remote",
};

/** Existing core options keep their meaning; an unknown option has no implicit access. */
export function eventAttendanceAccessMode(option: {
  value: string;
  accessMode?: EventAttendanceAccessMode;
}): EventAttendanceAccessMode {
  if (option.accessMode) return option.accessMode;
  return Object.hasOwn(LEGACY_ATTENDANCE_ACCESS, option.value) ? LEGACY_ATTENDANCE_ACCESS[option.value] : "none";
}
