/** Select an event by its known ID or resolve its public slug inside the same batch. */
export type EventReadSelection = string | { slug: string } | { referralCode: string };

export function eventReadIdSql(selection: EventReadSelection) {
  return typeof selection === "string"
    ? { sql: "?", bindings: [selection] }
    : "slug" in selection
      ? { sql: "(SELECT id FROM events WHERE slug = ?)", bindings: [selection.slug] }
      : { sql: "(SELECT event_id FROM referral_codes WHERE code = ?)", bindings: [selection.referralCode] };
}
