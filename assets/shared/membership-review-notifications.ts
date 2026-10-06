/** Daily consensus notices share a delivery window, never reviewer eligibility. */
export const MEMBERSHIP_REVIEW_DIGEST_BODY = `# {{stepLabel}}

We have received the following membership applications for review:

{{applicationSummary}}

Feedback and approval must be based solely on whether the applicant meets the stated membership criteria, without competitive considerations. Outreach should focus on collaboration and community.

{{instructions}}

Eligible reviewers have {{durationDays}} days after this notice is sent to respond. Each review page shows the exact deadline and current requirements. Record questions and objections on the review page.

## Application details

{{applicationDetails}}

Receiving this notice does not grant review permission. Sign in with your own account; eligibility is checked when you respond.`;

/** The completed UTC day's notices become eligible for the existing outbox runner. */
export function membershipReviewDigestSendAt(now: string): string {
  const day = new Date(now);
  day.setUTCHours(24, 0, 0, 0);
  return day.toISOString();
}
