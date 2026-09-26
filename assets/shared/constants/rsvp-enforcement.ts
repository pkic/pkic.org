/** Central RSVP timing policy, consumed by the bounded D1 enforcement query. */
export const RSVP_WARNING_DELAY_HOURS = 1;
export const RSVP_FAR_EVENT_LEAD_HOURS = 14 * 24;
export const RSVP_NEAR_EVENT_LEAD_HOURS = 7 * 24;
export const RSVP_FAR_ACTION_DELAY_HOURS = 48;
export const RSVP_MID_ACTION_DELAY_HOURS = 24;
export const RSVP_NEAR_ACTION_DELAY_HOURS = 2;

// The enforcer's worst-case action batch contains the guarded event update,
// audit/history, attendance, waitlist, registration, participant, and outbox
// statements. Keep these limits next to the timing policy so config and tests
// use the same accounting contract.
export const RSVP_ENFORCEMENT_SELECTION_STATEMENTS = 3;
export const RSVP_ENFORCEMENT_MAX_ACTION_STATEMENTS = 6;
export const RSVP_ENFORCEMENT_D1_SAFETY_MARGIN = 100;
