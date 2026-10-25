/** Where a person's own email addresses live in the API. */
export const OWN_EMAILS_ENDPOINT = "/api/v1/users/current/emails";

/** Where "Add email address" leads: a form of its own under the user record. */
export function addEmailAddressPath(userId: string): string {
  return `/users/${encodeURIComponent(userId)}/emails/new`;
}
