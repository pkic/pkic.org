import { json } from "../../../../../_lib/http";
import { sha256Hex } from "../../../../../_lib/utils/crypto";
import { nowIso } from "../../../../../_lib/utils/time";
import { first } from "../../../../../_lib/db/queries";

interface ConfirmInfoRow {
  token_matches: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  organization_name: string | null;
  event_name: string;
  confirmation_token_expires_at: string | null;
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

  const tokenHash = await sha256Hex(token.trim());

  const row = await first<ConfirmInfoRow>(
    c.env.DB,
    `SELECT CASE WHEN r.confirmation_token_hash = ? THEN 1 ELSE 0 END AS token_matches,
            u.first_name, u.last_name, u.email, u.organization_name,
            e.name AS event_name, r.confirmation_token_expires_at
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     JOIN events e ON e.id = r.event_id
     WHERE (r.confirmation_token_hash = ? OR (? IS NOT NULL AND r.id = ?))
       AND r.status = 'pending_email_confirmation'
       AND e.slug = ?
     LIMIT 1`,
    [tokenHash, tokenHash, registrationId, registrationId, c.req.param("eventSlug")],
  );

  if (!row) {
    return json(empty);
  }

  const now = nowIso();
  const tokenMatches = row.token_matches === 1;
  const expired = Boolean(
    !tokenMatches || (row.confirmation_token_expires_at && row.confirmation_token_expires_at < now),
  );

  return json({
    firstName: tokenMatches ? (row.first_name ?? null) : null,
    lastName: tokenMatches ? (row.last_name ?? null) : null,
    email: tokenMatches ? (row.email ?? null) : null,
    organizationName: tokenMatches ? (row.organization_name ?? null) : null,
    eventName: row.event_name,
    expired,
    recoverable: !tokenMatches,
  } satisfies ConfirmInfoResponse);
}
