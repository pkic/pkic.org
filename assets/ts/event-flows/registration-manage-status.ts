/** The words and tones the attendee manage page uses for registration, attendance and waitlist states. */
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
  if (paymentDue) return { label: PAYMENT_REQUIRED_STATUS.label, tone: "warn" };
  return { label: "Confirmed", tone: "ok" };
}

/** A registration whose ticket is still to be paid is not confirmed, whatever its lifecycle status says. */
export const PAYMENT_REQUIRED_STATUS = { label: "Payment required", cssClass: "pk-badge--warn" } as const;

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
