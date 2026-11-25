import { sqlString, NOW } from "../sql.mjs";
import { previewScaleId } from "../seed-ids.mjs";
import { seededStream } from "./random.mjs";

/**
 * Sponsor leads: the event's sponsor-data-sharing term, the attendees who
 * accepted it, and leads already captured for the sponsor account's
 * sponsorship, so its Leads list has rows and its scanner has people left to
 * scan. Leads go through the same scan attempt a badge scan records.
 */
const TERM_KEY = "sponsor-data-sharing";
const TERM_VERSION = "v1";
const CONSENT_SHARE = 0.6;
const CAPTURED_LEADS = 30;
const SCANNABLE_CODES = 5;

/** Registrations that accepted sponsor sharing and hold a badge, in seed order. */
function consentingRegistrations(eventId, registrations, seed) {
  return registrations.filter(
    (registration) =>
      registration.status === "registered" && seededStream(seed, `${eventId}:sponsor-consent:${registration.id}`)() < CONSENT_SHARE,
  );
}

/** What each sponsor account can capture: leads seeded for it, and badge codes left to scan. */
export function buildSponsorLeads({ eventId, registrations, personas, seed }) {
  const consenting = consentingRegistrations(eventId, registrations, seed);
  const sponsors = personas.filter((persona) => persona.sponsorship);
  const badged = consenting.filter((registration) => registration.badge);
  const captured = sponsors.length > 0 ? badged.slice(0, CAPTURED_LEADS) : [];
  const scannable = sponsors.length > 0
    ? badged.slice(CAPTURED_LEADS, CAPTURED_LEADS + SCANNABLE_CODES).map((registration) => registration.badge.code)
    : [];
  return { consenting, sponsors, captured, scannable };
}

export function sponsorLeadStatements(context, leads) {
  const event = sqlString(context.eventId);
  const statements = [
    `INSERT INTO event_terms (id, event_id, audience_type, term_key, version, required, active, display_text, help_text, created_at)
VALUES (${sqlString(previewScaleId(`${context.eventId}:term:${TERM_KEY}`))}, ${event}, 'attendee', '${TERM_KEY}', '${TERM_VERSION}', 0, 1,
  'Share my professional profile with the sponsors of this event.',
  'Sponsors whose staff scan your badge receive your name, organization, job title and email address.', ${NOW})
ON CONFLICT DO NOTHING;`,
  ];
  for (const registration of leads.consenting)
    statements.push(`INSERT INTO consent_acceptances (id, registration_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
VALUES (${sqlString(previewScaleId(`${registration.id}:consent:${TERM_KEY}`))}, ${sqlString(registration.id)}, ${event}, ${sqlString(registration.userId)}, 'attendee', '${TERM_KEY}', '${TERM_VERSION}', ${sqlString(registration.createdAt)})
ON CONFLICT DO NOTHING;`);
  for (const sponsor of leads.sponsors) {
    const sponsorId = sqlString(sponsor.sponsorship.id);
    const operator = `(SELECT id FROM users WHERE normalized_email = ${sqlString(sponsor.email)})`;
    for (const registration of leads.captured) {
      const attemptId = sqlString(previewScaleId(`${registration.id}:lead:${sponsor.sponsorship.id}`));
      statements.push(
        `INSERT INTO event_scan_attempts (id, event_id, sponsor_id, badge_id, user_id, operator_user_id, device_id, operation_id, request_hash, outcome, reason, action, observed_at, created_at)
SELECT ${attemptId}, ${event}, ${sponsorId}, ${sqlString(registration.badge.id)}, ${sqlString(registration.userId)}, ${operator}, 'preview-scale-seed', ${attemptId}, 'preview-scale-seed', 'eligible', 'eligible', 'lead', ${NOW}, ${NOW}
WHERE ${operator} IS NOT NULL
ON CONFLICT DO NOTHING;`,
        `INSERT INTO event_sponsor_leads (id, event_id, sponsor_id, user_id, operator_user_id, observed_at)
SELECT ${attemptId}, event_id, sponsor_id, user_id, operator_user_id, observed_at FROM event_scan_attempts WHERE id = ${attemptId}
ON CONFLICT DO NOTHING;`,
      );
    }
  }
  return statements;
}
