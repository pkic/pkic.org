import { EMAIL_TEMPLATE_ACTION_FIELDS } from "../../../assets/shared/email-template-actions";

/** Check delivered content, including stored templates created before action links were added. */
export function assertRequiredEmailActions(
  templateKey: string,
  payload: Record<string, unknown>,
  rendered: { html: string; text: string },
): void {
  const fields = Object.hasOwn(EMAIL_TEMPLATE_ACTION_FIELDS, templateKey)
    ? EMAIL_TEMPLATE_ACTION_FIELDS[templateKey]!
    : [];
  for (const field of fields) {
    const value = payload[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value) throw new Error("Email is missing a required action link.");
    const encoded = encodeURIComponent(value);
    const hasLink = [...rendered.html.matchAll(/<a\b[^>]*\bhref\s*=(["'])(.*?)\1/gi)].some(
      (match) => /^https?:\/\//i.test(match[2]!) && (match[2]!.includes(value) || match[2]!.includes(encoded)),
    );
    if (!hasLink || (!rendered.text.includes(value) && !rendered.text.includes(encoded)))
      throw new Error("Email is missing a required action link. Update the email template before retrying.");
  }
}
