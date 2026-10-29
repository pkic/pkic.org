import { z } from "zod";

export const attendanceIconSchema = z.enum(["location", "video", "play", "calendar", "people", "roundtable", "none"]);
export type AttendanceIconName = z.infer<typeof attendanceIconSchema>;

export const ATTENDANCE_ICON_LABELS: Record<AttendanceIconName, string> = {
  location: "Location",
  video: "Video",
  play: "Play",
  calendar: "Calendar",
  people: "People",
  roundtable: "Roundtable",
  none: "No icon",
};

const DEFAULT_ICONS: Readonly<Record<string, AttendanceIconName>> = {
  in_person: "location",
  virtual: "video",
  on_demand: "play",
};

/** Custom attendance choices carry no implied meaning until an organizer chooses an icon. */
export function attendanceIconName(type: string, configured?: AttendanceIconName): AttendanceIconName {
  return configured ?? DEFAULT_ICONS[type] ?? "none";
}
