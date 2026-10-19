import { eventProfileKeySchema } from "./schemas/event-series";

export const nativeEventCaptureProfileSchema = eventProfileKeySchema.extract(["meeting", "board_meeting"]);

/** Calendar context for event-wide observations, independent of native agenda item eligibility. */
export function nativeEventCaptureApplies(input: {
  profileKey: string | null | undefined;
  publishedRevision: number | null;
  occurrenceId?: string | null;
  roomId?: string | null;
  offlineRight?: unknown;
}): boolean {
  return (
    nativeEventCaptureProfileSchema.safeParse(input.profileKey).success &&
    input.publishedRevision === null &&
    !input.occurrenceId &&
    !input.roomId &&
    input.offlineRight === undefined
  );
}
