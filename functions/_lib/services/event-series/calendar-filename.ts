import { slugify, slugifyOr } from "../../../../assets/shared/slug";

/** A readable ASCII filename, safe for both MIME and Content-Disposition. */
export function meetingCalendarFilename(eventName: string, groupSlug?: string): string {
  return `${[groupSlug ? slugify(groupSlug, { maxLength: 60 }) : "", slugifyOr(eventName, "meeting", { maxLength: 100 })].filter(Boolean).join("-")}.ics`;
}
