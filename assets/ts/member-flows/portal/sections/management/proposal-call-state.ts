import type { EventProposalCall } from "../../../../../shared/schemas/event-management";
import { formatDateTimeInZone } from "../../../../../shared/format-date";
import type { SubmissionPlacement } from "./EventSubmissionWindow";

/**
 * Where an event's call for proposals stands, and why, for the organizer.
 *
 * The server's verdict (`proposalCall` on the event) decides whether the call
 * is open, because it also knows whether the event has a public page to submit
 * through. The window and the event's end explain a closed call in words an
 * organizer can act on.
 */
export type ProposalCallState =
  | { status: "open"; path: string | null }
  | { status: "closed"; reason: string; reopenable: boolean }
  | { status: "not_set_up"; reason: string };

export interface ProposalCallInputs {
  /** The proposal form's placement; null when none is chosen, undefined when the reader cannot see it. */
  placement: SubmissionPlacement | null | undefined;
  call?: EventProposalCall;
  endsAt: string | null;
  timeZone: string;
  now: Date;
}

export const NO_PROPOSAL_FORM_REASON = "No proposal form has been chosen yet.";

export function proposalCallState({ placement, call, endsAt, timeZone, now }: ProposalCallInputs): ProposalCallState {
  if (placement === null) return { status: "not_set_up", reason: NO_PROPOSAL_FORM_REASON };
  const instant = now.getTime();
  const at = (value: string | null | undefined) => (value ? new Date(value).getTime() : null);
  const ends = at(endsAt);
  if (ends !== null && ends <= instant) return { status: "closed", reason: "The event has ended.", reopenable: false };
  // Without the placement only the server's verdict is known.
  if (placement === undefined) {
    return call?.open
      ? { status: "open", path: call.path }
      : { status: "closed", reason: "Proposals are not being accepted.", reopenable: false };
  }
  const opens = at(placement.opensAt);
  if (opens !== null && opens > instant) {
    return {
      status: "closed",
      reason: `Not open yet. It opens ${formatDateTimeInZone(placement.opensAt, timeZone)}.`,
      reopenable: false,
    };
  }
  const closes = at(placement.closesAt);
  if (closes !== null && closes <= instant) {
    return {
      status: "closed",
      reason: `Closed since ${formatDateTimeInZone(placement.closesAt, timeZone)}.`,
      reopenable: true,
    };
  }
  if (call?.open === false) {
    return {
      status: "closed",
      reason:
        "The window is open, but proposals cannot be submitted: the event has no published submission page, or its proposal form is switched off.",
      reopenable: false,
    };
  }
  return { status: "open", path: call?.path ?? null };
}
