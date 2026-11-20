/**
 * The invitation's wording in one place. What the invitation says comes from
 * the event (`readEventInvitationMessage`); this module holds only the
 * neutral fallback built from the event's name and the structural labels the
 * card, the dialog and the decline survey share.
 */
import type { EventInvitationMessage } from "./schemas/event-invitation-message";

export interface EventInvitationWording {
  headline: string;
  /** Markdown from the event, or null when the event sets none. */
  message: string | null;
}

/** The event's own wording, or a neutral headline from its name when it sets none. */
export function eventInvitationWording(
  event: { name: string },
  message: EventInvitationMessage | null | undefined,
): EventInvitationWording {
  return {
    headline: message?.headline ?? `You're invited to ${event.name}`,
    message: message?.message ?? null,
  };
}

export const EVENT_INVITATION_ACTIONS = {
  register: "Register now",
  later: "Remind me next week",
  decline: "I can't attend",
  manage: "Manage registration",
} as const;

/** What an invitation or registration card says about the reader's standing. */
export const EVENT_INVITATION_STATES = {
  invited: "Invited",
  registered: "Registered",
  pending: "Confirm your email to finish registering",
} as const;

/** The attendee decline survey's reasons, shared by the emailed decline page and the portal. */
export const ATTENDEE_DECLINE_REASON_LABELS = {
  schedule_conflict: "Schedule conflict - I have another commitment",
  travel_not_possible: "Travel is not possible for me",
  content_not_relevant: "Content is not relevant to my role",
  organization_policy: "Organization policy prevents me from attending",
  not_interested: "This event doesn't match my current focus",
  already_registered: "I'm already registered through another link",
  other: "Other reason",
} as const;

export const ATTENDEE_DECLINE_COPY = {
  heading: "Not able to make it?",
  intro: "Please let us know why. It helps us improve future events and make them more relevant to people like you.",
  reasonLabel: "Reason for declining",
  noteLabel: "Additional comments",
  unsubscribe: "Don't send me invitations to future events",
  submit: "Decline this invitation",
  declined: "Invitation declined",
  postponed: "We'll remind you in a week",
} as const;
