import { json } from "../../../../../_lib/http";
import { first } from "../../../../../_lib/db/queries";
import { verifyDatabaseCapability } from "../../../../../_lib/services/capability-links";
import { requireInternalSecret } from "../../../../../_lib/request";

interface ConfirmInfoRow {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  organization_name: string | null;
  event_name: string;
}

interface ConfirmInfoResponse {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  organizationName: string | null;
  eventName: string | null;
  /** True when the confirmation token exists but has passed its expiry time. */
  expired: boolean;
  recoverable: boolean;
}

/**
 * GET /api/v1/events/:eventSlug/registrations/confirm-info?token=...
 *
 * Read-only preview endpoint for the email-confirmation landing page.
 * Returns the attendee's first name and event name for the given pending
 * confirmation token so the page can display a personalised greeting before
 * the user clicks Confirm — without embedding PII in the URL.
 *
 * Deliberately returns null values (not an error) when the token is absent
 * or not found; the page degrades gracefully and the POST confirm step will
 * surface any real validation errors.
 */
export async function onRequestGet(c: any): Promise<Response> {
  c.set("sensitive", true);
  const token = new URL(c.req.raw.url).searchParams.get("token");
  const registrationId = new URL(c.req.raw.url).searchParams.get("id");

  const empty: ConfirmInfoResponse = {
    firstName: null,
    lastName: null,
    email: null,
    organizationName: null,
    eventName: null,
    expired: false,
    recoverable: false,
  };

  if (!token || token.trim().length === 0) {
    return json(empty);
  }

  const verified = await verifyDatabaseCapability({
    db: c.env.DB,
    signingSecret: requireInternalSecret(c.env),
    purpose: "registration_confirm",
    token: token.trim(),
  });
  const resourceId = verified.ok ? verified.resourceId : registrationId;

  if (!resourceId || (registrationId && verified.ok && registrationId !== verified.resourceId)) {
    return json(empty);
  }

  const row = await first<ConfirmInfoRow>(
    c.env.DB,
    `SELECT u.first_name, u.last_name, u.email, u.organization_name,
            e.name AS event_name
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     JOIN events e ON e.id = r.event_id
     WHERE r.id = ?
       AND r.status = 'pending_email_confirmation'
       AND e.slug = ?
     LIMIT 1`,
    [resourceId, c.req.param("eventSlug")],
  );

  if (!row) {
    return json(empty);
  }

  const tokenMatches = verified.ok;

  return json({
    firstName: tokenMatches ? (row.first_name ?? null) : null,
    lastName: tokenMatches ? (row.last_name ?? null) : null,
    email: tokenMatches ? (row.email ?? null) : null,
    organizationName: tokenMatches ? (row.organization_name ?? null) : null,
    eventName: row.event_name,
    expired: !tokenMatches,
    recoverable: !tokenMatches,
  } satisfies ConfirmInfoResponse);
}
