import { AppError } from "../../errors";

/**
 * The one rule for when an identity ended: the requested instant, or now. It
 * can be neither in the future nor before the identity started.
 */
export function resolveIdentityEndedAt(requested: string | undefined, startedAt: string | null, now: string): string {
  const endedAt = requested ?? now;
  if (endedAt > now) {
    throw new AppError(422, "IDENTITY_END_DATE_INVALID", "The end date can't be in the future");
  }
  if (startedAt && endedAt < startedAt) {
    throw new AppError(422, "IDENTITY_END_DATE_INVALID", "The end date can't be before the identity started");
  }
  return endedAt;
}
