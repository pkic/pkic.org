# Waitlist Logic

This is the current waitlist behavior in plain language.

## Two Different Things

There are two different kinds of "invite" in the system:

- A normal invite lets someone register for an event or submit a proposal.
- A waitlist offer gives someone a temporary chance to claim an available in-person seat.

The waitlist offer is the one that expires after a short claim window. Normal invite links are handled separately.

There is no whole-registration waitlist anymore. Waitlist behavior is per-day only.

## Per-Day Waitlists

For events with day-by-day attendance, the waitlist also works day by day.

That means a person can be registered for the event overall, confirmed for Monday, and still waitlisted for Tuesday. Their main registration can still say `registered`; the day-specific waitlist records describe what is happening for each day.

In emails and admin filters, do not use the main registration status alone to decide whether someone is waitlisted. Use the day attendance details and the derived waitlist fields.

## What Happens When Someone Registers

When someone asks for an in-person seat on a day:

- If there is room for that day, they are confirmed for that day.
- If the day is full, they are put on that day's waitlist.
- If they change that day to virtual or remove it, their active waitlist entry for that day is removed.
- If they are capacity-exempt, they do not stay on the active waitlist.

Each day has its own waitlist order.

## Who Gets Offered A Seat First

When a seat opens for a day, the system offers it to someone on that day's waitlist.

People who already have another confirmed in-person day for the same event are prioritized first. This helps avoid cases where someone is confirmed for only part of a multi-day event while another person gets their first in-person day.

After that, people are ordered by their waitlist position.

A person can only have one active day waitlist offer at a time for the same event. If they already have an open offer for one day, the system skips them for other day offers until that first offer is accepted or expires.

An active offer temporarily reserves the available seat. The system should not offer the same open seat to multiple people at the same time.

## How Long An Offer Is Valid

A waitlist offer is valid for `WAITLIST_CLAIM_WINDOW_HOURS`.

If that setting is not configured, the default is **24 hours**.

When an offer is made, the row stores an expiry time. The attendee must claim the offer before that time.

## How Someone Claims A Day Offer

The attendee claims the offer by updating their registration while keeping that day selected as in-person.

If the offer is still valid, the day becomes confirmed for them.

If the offer has expired, it is not accepted.

## What Happens If An Offer Expires

An expired offer does not hold a seat.

The system marks expired day offers as expired when waitlist promotion or claim handling runs. Promotion always checks for expired offers before making new offers.

The scheduled backend job runs waitlist promotion together with reminders, RSVP enforcement, and queued email delivery. Promotion can also be triggered manually from the admin waitlist action.

Every promotion should send a waitlist-offer email and write an audit log. No backend path should silently change a person from `waiting` to `offered`.

## What If The Attendee Tries Later

They do not keep their old offered seat.

If they still want the in-person day and the day is still full, they are put back on the waitlist at their old position. They do not get another offer immediately from that action.

They receive a new email only when promotion runs later and a seat is available for them again.

## Normal Invite Links

Normal invite links are separate from waitlist offers.

Normal invite links currently do not expire in normal use. Invite creation supports an optional expiry setting for future configuration, but the current invite flows generally do not use it.

Even if an invite row has an old `expires_at` value, the accept path currently only checks whether the invite status is still `sent`. Tests currently confirm that behavior.

An invite link stops working once its status changes to something like `accepted`, `declined`, `expired`, or `revoked`.

Using an inactive invite later does not automatically put the person back on a waitlist. They need another valid way to register, such as a new invite, open registration, or an admin action.

## Email And Campaigns

For per-day events, emails should show the status for each day. For example, Monday can be confirmed while Tuesday is waitlisted.

Campaign filters also need to use day waitlist state. Filtering only for registrations with status `waitlisted` will miss people whose overall registration is `registered` but who are waitlisted for one or more days.
