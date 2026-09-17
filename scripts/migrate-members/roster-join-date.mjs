import { zonedDateTimeToDate } from "../../assets/shared/timezone.ts";

/**
 * Exported zone display names are ambiguous; require an approved IANA override.
 * @param {import("../../assets/shared/timezone.ts").ZonedDateTimeParts | null} parts
 * @param {string | null} exportedZone
 * @param {string | null} sourceTimeZone
 */
export function rosterJoinedAt(parts, exportedZone = null, sourceTimeZone = null) {
  if (!parts) return null;
  const zone = sourceTimeZone || exportedZone;
  if (!zone || (zone !== "UTC" && !zone.includes("/"))) {
    throw new Error(
      "Roster join dates require an IANA time zone; supply --roster-time-zone for exports with a display name or abbreviation",
    );
  }
  return zonedDateTimeToDate(parts, zone).toISOString();
}
