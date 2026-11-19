/**
 * Why a session's live room did not open, in the words of the person it
 * failed for: an operator at the control desk or an attendee asking
 * questions. The reason is the error code the room closed a refused socket
 * with, or the reference of a fault on our side; without either, the room
 * could not be reached, which is the only case that blames the connection.
 */
export type LiveRoomAudience = "operator" | "attendee" | "chat";

type FailureCopy = Readonly<Record<LiveRoomAudience, string>>;

const SIGN_IN_AGAIN: FailureCopy = {
  operator: "Your sign-in has ended. Sign in again to operate this session.",
  attendee: "Your sign-in has ended. Sign in again to ask and vote.",
  chat: "Your sign-in has ended. Sign in again to join session chat.",
};

const OPEN_FAILURES: Readonly<Record<string, FailureCopy>> = {
  LIVE_SESSION_NOT_FOUND: {
    operator: "This session has no live room yet. Only scheduled sessions on the approved agenda have one.",
    attendee: "This session doesn't take live questions yet.",
    chat: "This session has no live chat yet.",
  },
  EVENT_NOT_FOUND: {
    operator: "This event no longer exists, so its live rooms are closed.",
    attendee: "This event no longer exists, so its questions are closed.",
    chat: "This event no longer exists, so its chat is closed.",
  },
  AUTH_REQUIRED: SIGN_IN_AGAIN,
  AUTH_EXPIRED: SIGN_IN_AGAIN,
  AUTH_INVALID: SIGN_IN_AGAIN,
  LIVE_SESSION_ACCESS_REQUIRED: {
    operator: "You don't have live moderation access for this event. Ask an event organizer to grant it.",
    attendee: "Questions are open to registered attendees with access to this session.",
    chat: "Chat is open to registered attendees with access to this session.",
  },
};

const REFUSED: FailureCopy = {
  operator: "The live room refused this session. Reload the page to try again.",
  attendee: "Questions for this session didn't open. Reload the page to try again.",
  chat: "Chat for this session didn't open. Reload the page to try again.",
};

const UNREACHABLE: FailureCopy = {
  operator: "The live room can't be reached right now. Check your connection, then reload the page.",
  attendee: "Questions can't be reached right now. Check your connection, then reload the page.",
  chat: "Chat can't be reached right now. Check your connection, then reload the page.",
};

const FAULT_SUBJECT: FailureCopy = {
  operator: "the live room isn't",
  attendee: "questions aren't",
  chat: "chat isn't",
};

/** A fault on our side: nothing the reader can fix, so it asks them to tell us, with the reference to quote. */
function serverFault(reference: string, audience: LiveRoomAudience): string {
  return `Something went wrong on our side, so ${FAULT_SUBJECT[audience]} available. Let us know and quote reference ${reference}.`;
}

/** What failed for this audience: the refusal the room gave, a fault on our side, or that it could not be reached. */
export function liveRoomOpenFailure(
  refusalCode: string | null,
  audience: LiveRoomAudience,
  faultReference: string | null = null,
): string {
  if (refusalCode) return (OPEN_FAILURES[refusalCode] ?? REFUSED)[audience];
  return faultReference ? serverFault(faultReference, audience) : UNREACHABLE[audience];
}
