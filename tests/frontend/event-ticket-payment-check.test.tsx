/**
 * The ticket page asks the payment provider once when it opens on an unpaid
 * ticket, so a person back from the payment page is not asked to pay again
 * while the provider's own notice is still on its way.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrationTicketSchema } from "../../assets/shared/schemas/registration-tickets";
import { EventTicket } from "../../assets/ts/member-flows/portal/sections/events/app/EventTicket";
import { participantEventFixture, registeredParticipant } from "../helpers/participant-event";
import { EventTicketPayment } from "../../assets/ts/member-flows/portal/sections/events/app/EventTicketPayment";
import { RegistrationTicketPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/registration-detail/RegistrationTicketPanel";
import { menuPath } from "./helpers/menu-path";

const { postJson, getJson, putJson } = vi.hoisted(() => ({ postJson: vi.fn(), getJson: vi.fn(), putJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => ({ postJson, getJson, putJson }));

const ticket = registrationTicketSchema.parse({
  id: "20000000-0000-4000-8000-0000000000aa",
  ticketKey: "attendee",
  ticketName: "Attendee",
  source: "default",
  status: "pending_payment",
  amount: 19500,
  currency: "usd",
  codeLabel: null,
  paidAt: null,
  disputed: false,
  disputeReason: null,
  refundPending: false,
  refundFailed: false,
  paymentReference: null,
  refundedAmount: 0,
});
const registrationId = "20000000-0000-4000-8000-0000000000ab";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  postJson.mockReset();
  getJson.mockReset();
  putJson.mockReset();
});

afterEach(() => {
  render(null, host);
  host.remove();
});

async function open(onSettled = vi.fn(), held = ticket) {
  await act(async () => {
    render(
      <EventTicketPayment
        slug="summit"
        registrationId={registrationId}
        ticket={held}
        details={null}
        onSettled={onSettled}
      />,
      host,
    );
  });
  // The provider's answer settles a few microtasks after the page opens.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return onSettled;
}

describe("ticket payment check", () => {
  it("reads the ticket again when the payment turns out to have arrived", async () => {
    postJson.mockResolvedValue({ success: true, changed: true });
    const onSettled = await open();
    expect(postJson.mock.calls[0]![0]).toBe(`/api/v1/events/summit/registrations/${registrationId}/ticket/sync`);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("asks for the payment when it has not arrived, or when the provider gives no answer", async () => {
    postJson.mockResolvedValue({ success: true, changed: false });
    const onSettled = await open();
    expect(onSettled).not.toHaveBeenCalled();
    expect(host.textContent).toContain("$195 to pay");
    expect(host.querySelector("button")?.textContent).toBe("Pay for your ticket");

    render(null, host);
    postJson.mockRejectedValue(new Error("unavailable"));
    await open(onSettled);
    expect(onSettled).not.toHaveBeenCalled();
    expect(host.querySelector("button")?.textContent).toBe("Pay for your ticket");
  });

  it("asks for nothing while a payment that takes days is on its way", async () => {
    postJson.mockResolvedValue({ success: true, changed: false });
    await open(vi.fn(), { ...ticket, paymentProcessing: true });
    expect(host.textContent).toContain("Your payment is being processed");
    expect(host.querySelector("button")).toBeNull();
  });

  it("withholds the badge and payment action while a payment is under review", async () => {
    await open(vi.fn(), { ...ticket, status: "payment_under_review" });
    expect(host.textContent).toContain("Payment under review");
    expect(host.textContent).toContain("Contact the event organizers.");
    expect(host.querySelector("button")).toBeNull();
    expect(postJson).not.toHaveBeenCalled();
  });
});

describe("ticket page after a payment", () => {
  it("says the payment was received once the provider confirms it during the visit", async () => {
    getJson.mockResolvedValueOnce({ ticket }).mockResolvedValue({ ticket: { ...ticket, status: "paid" } });
    postJson.mockResolvedValue({ success: true, changed: true });
    putJson.mockRejectedValue(new Error("no badge in this test"));
    const onSettled = vi.fn();
    await act(async () => {
      render(<EventTicket event={participantEventFixture(registeredParticipant)} onSettled={onSettled} />, host);
    });
    // The page loads the ticket, loads the payment view, asks the provider and reads the ticket again.
    await vi.waitFor(() => expect(host.textContent).toContain("Payment received"));
    expect(host.textContent).toContain("You're registered.");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a payment on a ticket that was already paid", async () => {
    getJson.mockResolvedValue({ ticket: { ...ticket, status: "paid" } });
    putJson.mockRejectedValue(new Error("no badge in this test"));
    await act(async () => {
      render(<EventTicket event={participantEventFixture(registeredParticipant)} />, host);
    });
    await vi.waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(host.textContent).not.toContain("Payment received");
    expect(postJson).not.toHaveBeenCalled();
  });

  it("never requests a badge for a ticket under review", async () => {
    getJson.mockResolvedValue({ ticket: { ...ticket, status: "payment_under_review" } });
    await act(async () => {
      render(<EventTicket event={participantEventFixture(registeredParticipant)} />, host);
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Payment under review"));
    expect(putJson).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Pay for your ticket");
  });
});

describe("organizer ticket record", () => {
  it("shows the payment review state and withheld admission on the ticket record", async () => {
    getJson.mockResolvedValue({ ticket: { ...ticket, status: "payment_under_review" } });
    await act(async () => {
      render(<RegistrationTicketPanel slug="summit" registrationId={registrationId} canManage />, host);
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Payment under review"));
    expect(host.textContent).toContain("The attendee's badge and check-in code are unavailable.");
    await menuPath(document.body, "Ticket actions", ["Update from payment provider"]);
    expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).not.toContain(
      "Refund ticket",
    );
  });
});
