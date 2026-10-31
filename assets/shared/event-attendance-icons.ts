import { z } from "zod";

export const attendanceIconSchema = z.enum([
  "location",
  "video",
  "video_location",
  "video_people",
  "play",
  "calendar",
  "people",
  "roundtable",
  "cocktail",
  "coffee",
  "dining",
  "none",
]);
export type AttendanceIconName = z.infer<typeof attendanceIconSchema>;

export const ATTENDANCE_ICON_LABELS: Record<AttendanceIconName, string> = {
  location: "Location",
  video: "Video",
  video_location: "Location and video",
  video_people: "Video and people",
  play: "Play",
  calendar: "Calendar",
  people: "People",
  roundtable: "Roundtable",
  cocktail: "Cocktail",
  coffee: "Coffee",
  dining: "Dining",
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
