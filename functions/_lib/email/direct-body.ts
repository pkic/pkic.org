/**
 * Direct-body email transport.
 *
 * Most queued mail renders a stored template, and that template supplies the
 * subject line. Some mail is instead the message itself — an event campaign
 * written in the campaign composer, a staff reply typed on a membership
 * application — and for those the text that was written has to be the text
 * that is delivered. Such a row records {@link DIRECT_EMAIL_TEMPLATE_KEY} as
 * its template and carries its body in the queued payload under
 * {@link DIRECT_EMAIL_BODY_PAYLOAD_KEY}; nothing then resolves a template that
 * could replace the author's subject with a canned one.
 *
 * The key is read and written only through this module so the queue side and
 * the delivery side cannot drift apart.
 */
import { DIRECT_EMAIL_TEMPLATE_KEY } from "../../../assets/shared/schemas/email-outbox";

export { DIRECT_EMAIL_TEMPLATE_KEY };

/** Reserved payload key holding a message whose body is the message. */
export const DIRECT_EMAIL_BODY_PAYLOAD_KEY = "__directBodyContent";

/** The queued payload fragment for a direct body, or for the absence of one. */
export function directEmailBodyPayload(body: string | null | undefined): Record<string, string | null> {
  return { [DIRECT_EMAIL_BODY_PAYLOAD_KEY]: body ?? null };
}

/** The direct body a queued payload carries, or `null` when it renders a template. */
export function readDirectEmailBody(payload: Record<string, unknown>): string | null {
  const body = payload[DIRECT_EMAIL_BODY_PAYLOAD_KEY];
  return typeof body === "string" && body.length > 0 ? body : null;
}
