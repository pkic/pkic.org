import { json, markSensitive } from "../../../../../_lib/http";
import { sha256Hex } from "../../../../../_lib/utils/crypto";
import { nowIso } from "../../../../../_lib/utils/time";
import { first } from "../../../../../_lib/db/queries";
import type { PagesContext } from "../../../../../_lib/types";

interface ConfirmInfoRow {
  first_name: string | null;
  event_name: string;
  confirmation_token_expires_at: string | null;
}

interface ConfirmInfoResponse {
  firstName: string | null;
  eventName: string | null;
  /** True when the confirmation token exists but has passed its expiry time. */
  expired: boolean;
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
export async function onRequestGet(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  markSensitive(context);
  const token = new URL(context.request.url).searchParams.get("token");

  const empty: ConfirmInfoResponse = { firstName: null, eventName: null, expired: false };

  if (!token || token.trim().length === 0) {
    return json(empty);
  }

  const tokenHash = await sha256Hex(token.trim());

  const row = await first<ConfirmInfoRow>(
    context.env.DB,
    `SELECT u.first_name, e.name AS event_name, r.confirmation_token_expires_at
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     JOIN events e ON e.id = r.event_id
     WHERE r.confirmation_token_hash = ?
       AND r.status = 'pending_email_confirmation'
     LIMIT 1`,
    [tokenHash],
  );

  if (!row) {
    return json(empty);
  }

  const now = nowIso();
  const expired = Boolean(
    row.confirmation_token_expires_at && row.confirmation_token_expires_at < now,
  );

  return json({
    firstName: row.first_name ?? null,
    eventName: row.event_name,
    expired,
  } satisfies ConfirmInfoResponse);
}
