/**
 * Editable examples for manually reviewed attendee campaigns. Seeding these
 * does not create a campaign, select recipients, or schedule delivery.
 * Event variables come from buildEventEmailVariables; baseUrl comes from the
 * renderer. Session preferences and reservation status are resolved in the
 * authenticated portal, never guessed from the campaign's attendee audience.
 */
export const DEFAULT_EVENT_MESSAGE_TEMPLATES = [
  {
    key: "msg_attendee_session_favorites",
    subjectTemplate: "Save sessions that interest you — {{eventName}}",
    content: `{{#if firstName}}Hello {{firstName}},{{else}}Hello,{{/if}}

Use the star beside a session to save it to your personal agenda for **{{eventName}}**.

A favorite records your interest. It does not register you for the session, reserve a place, or grant invitation-only access. Check the session's requirements before attending.

[Open My agenda]({{baseUrl}}/portal/#/events/{{eventSlug}}/agenda)
`,
    contentType: "markdown",
  },
  {
    key: "msg_attendee_session_reminder",
    subjectTemplate: "Review your session plans — {{eventName}}",
    content: `{{#if firstName}}Hello {{firstName}},{{else}}Hello,{{/if}}

Before attending **{{eventName}}**, review the current times, locations, and access requirements for the sessions you want to join.

Your personal agenda shows saved favorites and session registration statuses separately. A favorite alone does not reserve a place. Review the current schedule again if the organizers announce changes.

[Review My agenda]({{baseUrl}}/portal/#/events/{{eventSlug}}/agenda)
`,
    contentType: "markdown",
  },
  {
    key: "msg_attendee_session_reservations",
    subjectTemplate: "Check session registration requirements — {{eventName}}",
    content: `{{#if firstName}}Hello {{firstName}},{{else}}Hello,{{/if}}

Some sessions at **{{eventName}}** require a reservation or approval. Open each session you want to attend and review its current registration status and access requirements.

Saving a favorite does not make a reservation. This message does not confirm a booking or approval. If your plans change, cancel any session registration you no longer need so its place can become available to someone else.

[Review session registrations]({{baseUrl}}/portal/#/events/{{eventSlug}}/agenda)
`,
    contentType: "markdown",
  },
  {
    key: "msg_attendee_session_waitlist",
    subjectTemplate: "Check session availability — {{eventName}}",
    content: `{{#if firstName}}Hello {{firstName}},{{else}}Hello,{{/if}}

If you are waiting for a session place at **{{eventName}}**, open the session in your personal agenda to check its current status and available actions.

A waitlist entry is not a confirmed place. This message does not announce that a place is available or that you have been admitted. Follow the session's current instructions, and consider other sessions if it remains full.

[Check My agenda]({{baseUrl}}/portal/#/events/{{eventSlug}}/agenda)
`,
    contentType: "markdown",
  },
];
