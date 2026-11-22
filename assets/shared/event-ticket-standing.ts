/**
 * Where a registration's ticket stands for the person who holds it, and the
 * one wording every screen uses for it: the event home, the events list, the
 * registration pages, the ticket page and the organizer's ticket panel.
 *
 * A ticket that waits for its holder asks for the payment. A ticket paid by a
 * method that takes days asks for nothing. Neither says "registered".
 */
export type TicketStanding = "settled" | "to_pay" | "processing" | "under_review";

export function ticketStanding(ticket: {
  paymentDue?: boolean;
  paymentProcessing?: boolean;
  paymentUnderReview?: boolean;
}): TicketStanding {
  if (ticket.paymentUnderReview) return "under_review";
  if (ticket.paymentProcessing) return "processing";
  return ticket.paymentDue ? "to_pay" : "settled";
}

export const TICKET_STANDING_COPY = {
  to_pay: {
    /** The heading of a card or notice about the ticket. */
    title: "Pay for your ticket",
    /** A notice on a page that is about the registration, not the ticket. */
    noticeTitle: "Your ticket is not paid yet",
    /** A short state beside other states. */
    status: "Payment required",
    body: "Your registration is saved. You're registered once your ticket is paid.",
    action: "Pay for your ticket",
    tone: "warn",
  },
  processing: {
    title: "Your payment is being processed",
    noticeTitle: "Your payment is being processed",
    status: "Payment processing",
    body: "Some payment methods take a few days. You're registered once the payment arrives, and we email your confirmation then.",
    action: null,
    tone: "info",
  },
  under_review: {
    title: "Payment under review",
    noticeTitle: "Your payment is under review",
    status: "Payment under review",
    body: "Your badge and check-in code are unavailable while the payment is under review. Contact the event organizers.",
    action: null,
    tone: "danger",
  },
} as const;
