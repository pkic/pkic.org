import { all } from "../db/queries";
import { parseJsonSafe } from "../utils/json";
import { getActiveFormByPurpose } from "../services/forms";
import type { DatabaseLike } from "../types";
import type { FormFieldDefinition } from "../services/forms/read";

export interface CustomAnswerRow {
  label: string;
  displayValue: string;
}

function formatCustomAnswerValue(fieldType: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return (value as unknown[]).map(String).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const range = value as { start?: string; end?: string };
    if (range.start && range.end) return `${range.start} – ${range.end}`;
  }
  return String(value);
}

/**
 * Map a parsed custom-answers record to display rows using the form field definitions
 * for human-readable labels. Boolean fields (T&C-style checkboxes) are skipped here
 * because they are surfaced separately as acceptedTermsText.
 */
export function buildCustomAnswerRows(
  customAnswers: Record<string, unknown> | null | undefined,
  formFields: FormFieldDefinition[] | null | undefined,
): CustomAnswerRow[] {
  if (!customAnswers || !formFields?.length) return [];
  const rows: CustomAnswerRow[] = [];
  for (const field of formFields) {
    if (field.fieldType === "boolean") continue; // covered by acceptedTermsText
    const value = customAnswers[field.key];
    if (value === undefined || value === null || value === "") continue;
    rows.push({
      label: field.label,
      displayValue: formatCustomAnswerValue(field.fieldType, value),
    });
  }
  return rows;
}

export function buildCustomAnswerVariables(
  customAnswers: Record<string, unknown> | null | undefined,
  formFields: FormFieldDefinition[] | null | undefined,
): Record<string, string> {
  if (!customAnswers || !formFields?.length) return {};
  const vars: Record<string, string> = {};
  for (const field of formFields) {
    const value = customAnswers[field.key];
    if (value === undefined || value === null || value === "") continue;
    vars[field.key] = formatCustomAnswerValue(field.fieldType, value);
  }
  return vars;
}

/**
 * Build a comma-separated list of accepted term titles from in-memory consent +
 * term lists. Useful immediately after registration creation when both are in scope.
 */
export function buildAcceptedTermsText(
  consents: Array<{ termKey: string; version: string }>,
  requiredTerms: Array<{ term_key: string; display_text: string | null }>,
): string {
  const acceptedKeys = new Set(consents.map((c) => c.termKey));
  return requiredTerms
    .filter((t) => acceptedKeys.has(t.term_key) && t.display_text)
    .map((t) => t.display_text as string)
    .join("  \n> - ");
}

/**
 * Query the accepted-term display titles for a registration from the database.
 * Use in flows where the original consent list is no longer in scope (e.g.
 * confirm-email, resend, update).
 */
export async function getAcceptedTermsTextForRegistration(
  db: DatabaseLike,
  registrationId: string,
): Promise<string> {
  const rows = await all<{ title: string | null }>(
    db,
    `SELECT et.display_text AS title
     FROM consent_acceptances ca
     JOIN event_terms et
       ON et.event_id    = ca.event_id
      AND et.term_key    = ca.term_key
      AND et.version     = ca.term_version
     WHERE ca.registration_id = ?
     ORDER BY ca.term_key ASC`,
    [registrationId],
  );
  return rows
    .map((r) => r.title)
    .filter(Boolean)
    .join("  \n> - ");
}

/**
 * Fetch the active registration form for an event and map the stored
 * custom_answers_json to display rows with human-readable labels.
 */
export async function getCustomAnswerRows(
  db: DatabaseLike,
  eventId: string,
  customAnswersJson: string | null | undefined,
): Promise<CustomAnswerRow[]> {
  if (!customAnswersJson) return [];
  const form = await getActiveFormByPurpose(db, eventId, "event_registration");
  if (!form) return [];
  const parsed = parseJsonSafe<Record<string, unknown> | null>(customAnswersJson, null);
  if (!parsed) return [];
  return buildCustomAnswerRows(parsed, form.fields);
}
