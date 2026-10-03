/** Only the currently active attendee term version authorizes sharing. Missing or replaced consent fails closed. */
export function sponsorConsentSql(registrationAlias: string): string {
  if (!/^[a-z_]+$/.test(registrationAlias)) throw new Error("Invalid registration SQL alias");
  return `EXISTS(SELECT 1 FROM consent_acceptances ca JOIN event_terms term ON term.event_id=ca.event_id AND term.audience_type='attendee' AND term.term_key='sponsor-data-sharing' AND term.version=ca.term_version AND term.active=1 WHERE ca.registration_id=${registrationAlias}.id AND ca.event_id=${registrationAlias}.event_id AND ca.user_id=${registrationAlias}.user_id AND ca.audience_type='attendee' AND ca.term_key='sponsor-data-sharing')`;
}
