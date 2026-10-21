# Glossary

One name for one thing, in code, copy, and documentation. Add a term here when you introduce it; rename everywhere when a term changes.

## People and organizations

- **User**: a person who signs in. Holds the personal profile.
- **About you**: an optional general introduction covering a person’s interests and roles, held on their personal identity. It does not imply individual membership.
- **Organization bio**: the biography on an organization identity, describing the person’s role and relevant experience there. Speaker profiles use the selected identity’s bio. When About you is empty, the portal may show the primary identity’s bio with attribution, without copying it.
- **Identity**: who a user acts as: themselves, or a capacity at an organization. Name, title, organization, bio, links, and headshot come only from the user and identity; nothing else stores a copy.
- **Acting identity**: the identity a user has chosen for the current action, switched from the account menu.
- **Representation**: an organization identity seen from the person holding it. It ends on a date; an end made by mistake is undone by **reinstating** it, which removes the end date from the same identity rather than starting a new one.
- **Organization**: a company or institution. Member organizations belong to the PKI Consortium.
- **Member**: an organization (or independent person) with a membership. Not a synonym for user.
- **Representative**: a person who acts for a member organization.
- **Group**: a working group, committee, or other body. People join a group in a **capacity** (for example member or chair).

## Events

- **Event**: a conference or other gathering, with its own IANA time zone. Event times show in that zone, labeled.
- **Meeting series**: a recurring meeting, expanded through its IANA time zone.
- **Proposal**: a session submitted for an event, with its speakers. Submitted during a **submission window**.
- **Speaker**: an identity on a proposal or session, in a speaker role (`assets/ts/shared/speaker-roles.ts`).
- **Session**: an accepted item on the agenda.
- **Occurrence**: one scheduled appearance of a session on the agenda: day, time, and room.
- **Agenda**: the published schedule of occurrences.
- **Registration**: a person's place at an event. A full event offers the **waitlist**.
- **Session hold**: a temporary seat reservation that expires.
- **Attendee**: a registered person at the event.
- **Check-in**: confirming an attendee's arrival, by badge scan or by hand.
- **Printed badge**: the attendee's name badge. In UI code, `Badge` means the status pill; say "printed badge" for the printed one.
- **Sponsor**: an organization supporting an event at a **sponsor tier**; **sponsor leads** are the contacts it collects.
- **Staffing**: the people assigned to run an occurrence or room.

## Live production

Vendor-neutral: never name a specific production tool.

- **Live session**: the streamed form of a session, with chat, reactions, questions, and polls.
- **Virtual room**: the attendee screen for a live session.
- **Studio** / **control room**: the operator screens that run a live session. Their layout never shifts.
- **Program**: what is on air.
- **Preview**: the next composition, edited before it goes on air.
- **Transition**: replace Program with Preview. It changes the overlay output, not the stream.
- **Output**: a destination that renders a composition: Program, Projector (room screen), Stage preview, Stage display (both speaker-facing).
- **Browser source**: the overlay page that production software loads for an output; its layout rides the query string.
- **Lower third**: the name and title graphic for the current speaker, taken from their identity.
- **Ticker**: the scrolling message line.
- **Switcher**: the production software, or the studio control that mirrors it.
