import type { ParticipationAvailability } from "./schemas/event-participation-availability";
import type { AgendaAdmissionPolicy } from "./schemas/event-agenda";
export interface AvailabilityEvidence {
  /** Derived from the person's registered attendance on the session's day; null when they attend neither way. */
  attendanceMode: "physical" | "remote" | null;
  policy: AgendaAdmissionPolicy;
  invitationRequired: boolean;
  invited: boolean;
  registered: boolean;
  registrationMode: string | null;
  opensAt: string | null;
  closesAt: string | null;
  sessionCapacity: number | null;
  sessionOccupied: number;
  /** The session's rooms as one physical pool; null when unlimited or remote. */
  poolCapacity: number | null;
  poolOccupied: number;
  allocationCompatible: boolean;
}
/** Read-only projection; canonical guarded commands still decide allocation at submission time. */
export function participationAvailability(evidence: AvailabilityEvidence, now: string): ParticipationAvailability {
  const base = { attendanceMode: evidence.attendanceMode };
  const deny = (state: ParticipationAvailability["state"], message: string) => ({
    ...base,
    state,
    message,
    bookingAction: null,
  });
  if (!evidence.registered)
    return deny("registration_required", "Register for the event before adding sessions to your agenda.");
  if (evidence.invitationRequired && !evidence.invited)
    return deny(
      "invitation_required",
      "Invitation required. You can save interest; an organizer must invite you before session registration.",
    );
  if (evidence.opensAt && evidence.opensAt > now)
    return deny("not_open", "Session registration has not opened yet. You can save a preference.");
  if (evidence.closesAt && evidence.closesAt <= now)
    return deny(
      "closed",
      "Session registration is closed. Existing registrations and saved preferences remain separate.",
    );
  const registrationMode = evidence.attendanceMode === "physical" ? "in_person" : "virtual";
  if (!evidence.attendanceMode || evidence.registrationMode !== registrationMode)
    return deny(
      "wrong_mode",
      "You are not attending in person or online on this session's day. Update your event attendance first.",
    );
  if (!evidence.allocationCompatible)
    return deny(
      "allocation_conflict",
      "Your approved event role uses a different attendance mode or location. Ask an organizer to review the allocation.",
    );
  if (evidence.sessionCapacity === 0 || evidence.poolCapacity === 0)
    return deny("closed", "This attendance location is closed to new session registrations.");
  const full =
    (evidence.sessionCapacity !== null && evidence.sessionOccupied >= evidence.sessionCapacity) ||
    (evidence.poolCapacity !== null && evidence.poolOccupied >= evidence.poolCapacity);
  const bookingAction =
    evidence.policy === "preference"
      ? null
      : evidence.policy === "approval"
        ? ("request" as const)
        : ("reserve" as const);
  return {
    ...base,
    state: full ? "full" : "available",
    bookingAction,
    message:
      evidence.policy === "preference"
        ? full
          ? "Full at the last refresh. Saving interest does not guarantee admission; entry remains first come, first served."
          : "Save a preference. Admission is first come, first served and no place is reserved."
        : evidence.policy === "optional_reservation"
          ? full
            ? "Optional registration is full at the last refresh. You can join the waiting list; attending without a reservation remains permitted."
            : "Registration is optional. Reserve an available place, or attend without a reservation. Saving interest does not reserve a place."
          : full
            ? evidence.policy === "approval"
              ? "Full at the last refresh. You can request approval; approval does not promise an available place."
              : "Full at the last refresh. You can join the waiting list; no place is reserved."
            : evidence.policy === "approval"
              ? "Request approval. A place is confirmed only after approval and available capacity."
              : "Places are available at the last refresh. Your place is confirmed only after the server accepts your reservation.",
  };
}
/** One short line for why a seat cannot be taken right now; the admission note says the rule itself. */
export const PARTICIPATION_AVAILABILITY_LABELS: Record<ParticipationAvailability["state"], string> = {
  available: "Seats available",
  full: "Full",
  closed: "Reservations are closed",
  not_open: "Reservations have not opened yet",
  invitation_required: "You have not been invited",
  registration_required: "Register for the event to reserve a seat",
  wrong_mode: "Your event registration does not include this day",
  allocation_conflict: "An organizer needs to review your event role first",
};
/**
 * A person attends a session the way they attend its day: an in-person day means a seat in
 * the room, a virtual day means joining online. No other registration mode attends.
 */
export function sessionAttendanceModeForDay(registrationMode: string | null): "physical" | "remote" | null {
  return registrationMode === "in_person" ? "physical" : registrationMode === "virtual" ? "remote" : null;
}
