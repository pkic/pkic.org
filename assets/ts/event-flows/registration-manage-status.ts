/** The words and tones the attendee manage page uses for registration, attendance and waitlist states. */
import { TICKET_STANDING_COPY, type TicketStanding } from "../../shared/event-ticket-standing";
import type { BadgeTone } from "../ui/Badge";

export function attendanceTypeLabel(attendanceType: string): string {
  switch (attendanceType) {
    case "in_person":
      return "In-person attendance";
    case "virtual":
      return "Virtual attendance";
    case "on_demand":
      return "On-demand attendance";
    default:
      return attendanceType;
  }
}

/** The tone of a day-waitlist entry. The words beside it carry the meaning. */
export function waitlistTone(status: string): BadgeTone {
  if (status === "offered") return "info";
  if (status === "accepted") return "ok";
  return "neutral";
}

/** What one day's waitlist state says, and the tone that agrees with it. */
export function dayConfirmation(
  waitlistStatus: string | undefined,
  paymentDue = false,
): { label: string; tone: BadgeTone } {
  if (waitlistStatus === "offered") return { label: "Spot available", tone: "info" };
  if (waitlistStatus === "waiting") return { label: "Waitlisted", tone: "warn" };
  if (paymentDue) return { label: TICKET_STANDING_COPY.to_pay.status, tone: TICKET_STANDING_COPY.to_pay.tone };
  return { label: "Confirmed", tone: "ok" };
}

/** The badge for a registration whose ticket is not settled; it is not confirmed, whatever its lifecycle status says. */
export function ticketStandingBadge(standing: Exclude<TicketStanding, "settled">): { label: string; cssClass: string } {
  const copy = TICKET_STANDING_COPY[standing];
  return { label: copy.status, cssClass: `pk-badge--${copy.tone}` };
}

export function statusLabel(
  status: string,
  cancellationReasonCode: string | null,
): { label: string; cssClass: string } {
  switch (status) {
    case "registered":
      return { label: "Confirmed", cssClass: "pk-badge--ok" };
    case "pending_email_confirmation":
      return { label: "Pending confirmation", cssClass: "pk-badge--neutral" };
    case "cancelled":
      return {
        label: cancellationReasonCode === "unauthorized_registration" ? "Cancelled (unauthorized)" : "Cancelled",
        cssClass: "pk-badge--danger",
      };
    default:
      return { label: status, cssClass: "pk-badge--neutral" };
  }
}
