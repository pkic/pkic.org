/** The completed UTC day's notices become eligible for the existing outbox runner. */
export function membershipReviewDigestSendAt(now: string): string {
  const day = new Date(now);
  day.setUTCHours(24, 0, 0, 0);
  return day.toISOString();
}
