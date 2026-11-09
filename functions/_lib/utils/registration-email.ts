import { buildD1JsonMembershipFilter } from "../db/json-membership";
import { formatCustomAnswerValue, isCustomAnswerRecord } from "./custom-answer-display";
import { resolveEventFormResponse } from "../services/forms";
import type { DatabaseLike } from "../types";
import type { EventFormResponseInput } from "../services/forms";
import type { FormFieldDefinition } from "../services/forms/read";

export type { EmailCustomAnswerRow as CustomAnswerRow } from "../../../assets/shared/schemas/email-template-data";
import type { EmailCustomAnswerRow as CustomAnswerRow } from "../../../assets/shared/schemas/email-template-data";
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
export function prepareAcceptedRegistrationTerms(db: DatabaseLike, registrationIds: string | readonly string[]) {
  const scope = buildD1JsonMembershipFilter(
    "ca.registration_id",
    typeof registrationIds === "string" ? [registrationIds] : registrationIds,
  );
  return db
    .prepare(`SELECT ca.registration_id, et.display_text AS title
     FROM consent_acceptances ca
     JOIN event_terms et
       ON et.event_id = ca.event_id AND et.audience_type = ca.audience_type
       AND et.term_key = ca.term_key AND et.version = ca.term_version
     WHERE ${scope.sql} ORDER BY ca.registration_id ASC, ca.term_key ASC`)
    .bind(...scope.bindings);
}

export interface AcceptedRegistrationTermRow {
  title: string | null;
}

export function decodeAcceptedRegistrationTerms(rows: AcceptedRegistrationTermRow[]): string {
  return rows
    .map((row) => row.title)
    .filter(Boolean)
    .join("  \n> - ");
}

export async function getAcceptedTermsTextForRegistration(db: DatabaseLike, registrationId: string): Promise<string> {
  return decodeAcceptedRegistrationTerms(
    (await prepareAcceptedRegistrationTerms(db, registrationId).all<AcceptedRegistrationTermRow>()).results,
  );
}

/** Load recorded acceptance text for one bounded recipient page without per-recipient queries. */
export async function loadAcceptedTermsTextForRegistrations(
  db: DatabaseLike,
  registrationIds: readonly string[],
): Promise<Map<string, string>> {
  if (!registrationIds.length) return new Map();
  const { results } = await prepareAcceptedRegistrationTerms(db, registrationIds).all<
    AcceptedRegistrationTermRow & { registration_id: string }
  >();
  const byRegistration = new Map<string, AcceptedRegistrationTermRow[]>();
  for (const row of results) {
    const terms = byRegistration.get(row.registration_id) ?? [];
    terms.push(row);
    byRegistration.set(row.registration_id, terms);
  }
  return new Map([...byRegistration].map(([id, terms]) => [id, decodeAcceptedRegistrationTerms(terms)]));
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
