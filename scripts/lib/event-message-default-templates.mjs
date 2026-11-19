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
    content: `{{> greeting}}

Building your plan for **{{eventName}}**? Star the sessions that interest you to save them to your agenda.

A star only saves the session for you. It doesn't reserve a place, so check whether a session needs registration before you go.

[Open my agenda]({{baseUrl}}/portal/#/events/{{eventSlug}}/agenda)
`,
    contentType: "markdown",
  },
  {
    key: "msg_attendee_session_reminder",
    subjectTemplate: "Review your session plans — {{eventName}}",
    content: `{{> greeting}}

**{{eventName}}** is coming up. Take a moment to check the times, rooms, and requirements of the sessions you want to join.

Your agenda shows the sessions you starred and those you registered for. A star alone doesn't reserve a place. If we announce schedule changes, check your agenda again.

[Review my agenda]({{baseUrl}}/portal/#/events/{{eventSlug}}/agenda)
`,
    contentType: "markdown",
  },
  {
    key: "msg_attendee_session_reservations",
    subjectTemplate: "Check which sessions need registration — {{eventName}}",
    content: `{{> greeting}}

Some sessions at **{{eventName}}** need a registration or an organizer's approval. Open each session you want to join to see its status and what it requires.

Starring a session doesn't register you, and this email doesn't confirm a place. If your plans change, cancel the session registrations you no longer need so someone else can take the place.

[Review my session registrations]({{baseUrl}}/portal/#/events/{{eventSlug}}/agenda)
`,
    contentType: "markdown",
  },
  {
    key: "msg_attendee_session_waitlist",
    subjectTemplate: "Check session availability — {{eventName}}",
    content: `{{> greeting}}

Waiting for a place in a session at **{{eventName}}**? Open it in your agenda to see its status and what you can do.

Being on the waitlist doesn't confirm a place, and this email doesn't mean one has opened up. If the session stays full, have a look at other sessions too.

[Check my agenda]({{baseUrl}}/portal/#/events/{{eventSlug}}/agenda)
`,
    contentType: "markdown",
  },
];
