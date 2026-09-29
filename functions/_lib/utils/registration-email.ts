import { all } from "../db/queries";
import { formatCustomAnswerValue, isCustomAnswerRecord } from "./custom-answer-display";
import { resolveEventFormResponse } from "../services/forms";
import type { DatabaseLike } from "../types";
import type { EventFormResponseInput } from "../services/forms";
import type { FormFieldDefinition } from "../services/forms/read";

export interface CustomAnswerRow {
  label: string;
  displayValue: string;
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
  if (!isCustomAnswerRecord(customAnswers) || !formFields?.length) return [];
  const rows: CustomAnswerRow[] = [];
  for (const field of formFields) {
    if (field.fieldType === "boolean") continue; // covered by acceptedTermsText
    const value = customAnswers[field.key];
    if (value === undefined || value === null || value === "") continue;
    rows.push({
      label: field.label,
      displayValue: formatCustomAnswerValue(value, field),
    });
  }
  return rows;
}

export function buildCustomAnswerVariables(
  customAnswers: Record<string, unknown> | null | undefined,
  formFields: FormFieldDefinition[] | null | undefined,
): Record<string, string> {
  if (!isCustomAnswerRecord(customAnswers) || !formFields?.length) return {};
  const vars: Record<string, string> = {};
  for (const field of formFields) {
    const value = customAnswers[field.key];
    if (value === undefined || value === null || value === "") continue;
    vars[field.key] = formatCustomAnswerValue(value, field);
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
export async function getAcceptedTermsTextForRegistration(db: DatabaseLike, registrationId: string): Promise<string> {
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
 * Resolve the exact response set when available, then map its normalized
 * answer values to human-readable rows. Current event configuration is used
 * only for legacy registrations without a stored response-set attribution.
 */
export async function getCustomAnswerRows(
  db: DatabaseLike,
  input: Omit<EventFormResponseInput, "source">,
): Promise<CustomAnswerRow[]> {
  const response = await resolveEventFormResponse(db, { ...input, source: "registration" });
  if (!response?.form) return [];
  return buildCustomAnswerRows(response.answers, response.form.fields);
}
