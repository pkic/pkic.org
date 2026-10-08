import type { ParticipationAvailability } from "./schemas/event-participation-availability";
import type { AgendaAdmissionPolicy } from "./schemas/event-agenda";
export interface AvailabilityEvidence {
  attendanceMode: "physical" | "remote";
  roomId: string | null;
  policy: AgendaAdmissionPolicy;
  invitationRequired: boolean;
  invited: boolean;
  registered: boolean;
  registrationMode: string | null;
  opensAt: string | null;
  closesAt: string | null;
  sessionCapacity: number | null;
  sessionOccupied: number;
  roomCapacity: number | null;
  roomOccupied: number;
  allocationCompatible: boolean;
}
/** Read-only projection; canonical guarded commands still decide allocation at submission time. */
export function participationAvailability(evidence: AvailabilityEvidence, now: string): ParticipationAvailability {
  const base = { attendanceMode: evidence.attendanceMode, roomId: evidence.roomId, canSave: true };
  const deny = (state: ParticipationAvailability["state"], message: string) => ({
    ...base,
    state,
    message,
    bookingAction: null,
  });
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
  if (!evidence.registered)
    return deny(
      "registration_required",
      "Register for the event before registering for this session. Saving a preference does not register you.",
    );
  const registrationMode = evidence.attendanceMode === "physical" ? "in_person" : "virtual";
  if (evidence.registrationMode !== registrationMode)
    return deny(
      "wrong_mode",
      `Your event-day attendance does not allow ${evidence.attendanceMode === "physical" ? "in-person" : "remote"} session registration. Update event attendance first.`,
    );
  if (!evidence.allocationCompatible)
    return deny(
      "allocation_conflict",
      "Your approved event role uses a different attendance mode or location. Ask an organizer to review the allocation.",
    );
  if (evidence.sessionCapacity === 0 || evidence.roomCapacity === 0)
    return deny("closed", "This attendance location is closed to new session registrations.");
  const full =
    (evidence.sessionCapacity !== null && evidence.sessionOccupied >= evidence.sessionCapacity) ||
    (evidence.roomCapacity !== null && evidence.roomOccupied >= evidence.roomCapacity);
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
export const PARTICIPATION_AVAILABILITY_LABELS: Record<ParticipationAvailability["state"], string> = {
  available: "Available",
  full: "Full",
  closed: "Closed",
  not_open: "Not open yet",
  invitation_required: "Invitation required",
  registration_required: "Event registration required",
  wrong_mode: "Different attendance mode",
  allocation_conflict: "Allocation review required",
};
