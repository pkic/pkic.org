/**
 * The event home while a ticket is unpaid: the card asks for the payment and
 * never says "registered", since the registration is not complete until then.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TicketCard } from "../../assets/ts/member-flows/portal/sections/events/app/EventHome";
import { EventRegister } from "../../assets/ts/member-flows/portal/sections/events/app/EventRegister";
import { participantEventFixture, registeredParticipant } from "../helpers/participant-event";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("event home ticket card", () => {
  it("asks for the payment, and does not say registered, while the ticket is unpaid", async () => {
    const unpaid = participantEventFixture({
      ...registeredParticipant,
      viewer: { ...registeredParticipant.viewer, paymentDue: true },
    });
    await act(() => render(<TicketCard event={unpaid} ended={false} />, host));
    expect(host.querySelector(".pk-event-card__title, h2, h3")?.textContent).toBe("Pay for your ticket");
    expect(host.textContent).toContain("You're registered once your ticket is paid.");
    expect(host.textContent).not.toContain("Show ticket");
    expect(host.querySelector('a[href="#/events/summit/ticket"]')?.textContent).toBe("Pay for your ticket");
  });

  it("asks for nothing while a payment that takes days is on its way", async () => {
    const processing = participantEventFixture({
      ...registeredParticipant,
      viewer: { ...registeredParticipant.viewer, paymentDue: true, paymentProcessing: true },
    });
    await act(() => render(<TicketCard event={processing} ended={false} />, host));
    expect(host.textContent).toContain("Your payment is being processed");
    expect(host.textContent).not.toContain("Pay for your ticket");
    expect(host.querySelector('a[href="#/events/summit/ticket"]')?.textContent).toBe("Show ticket");
  });

  it("shows a payment under review without asking to pay or claiming registration is confirmed", async () => {
    const underReview = participantEventFixture({
      ...registeredParticipant,
      viewer: { ...registeredParticipant.viewer, paymentUnderReview: true },
    });
    await act(() => render(<TicketCard event={underReview} ended={false} />, host));
    expect(host.textContent).toContain("Payment under review");
    expect(host.textContent).toContain("Contact the event organizers.");
    expect(host.textContent).not.toContain("Pay for your ticket");
    expect(host.querySelector('a[href="#/events/summit/ticket"]')?.textContent).toBe("Show ticket");
  });

  it("shows the ticket to a registration with nothing to pay", async () => {
    await act(() => render(<TicketCard event={participantEventFixture(registeredParticipant)} ended={false} />, host));
    expect(host.textContent).toContain("You're registered");
    expect(host.querySelector('a[href="#/events/summit/ticket"]')?.textContent).toBe("Show ticket");
  });
});

describe("register page for someone who already registered", () => {
  it("asks for the payment, and does not say registered, while the ticket is unpaid", async () => {
    const unpaid = participantEventFixture({
      ...registeredParticipant,
      viewer: { ...registeredParticipant.viewer, paymentDue: true },
    });
    await act(() => render(<EventRegister event={unpaid} />, host));
    expect(host.textContent).toContain("Your ticket is not paid yet");
    expect(host.textContent).not.toContain("already registered");
    expect(host.querySelector('a[href$="/events/summit/ticket"]')?.textContent).toBe("Pay for your ticket");
  });

  it("says registered once nothing is owed", async () => {
    await act(() => render(<EventRegister event={participantEventFixture(registeredParticipant)} />, host));
    expect(host.textContent).toContain("You're already registered for this event.");
  });

  it("explains a payment under review on the registration page", async () => {
    const underReview = participantEventFixture({
      ...registeredParticipant,
      viewer: { ...registeredParticipant.viewer, paymentUnderReview: true },
    });
    await act(() => render(<EventRegister event={underReview} />, host));
    expect(host.textContent).toContain("Your payment is under review");
    expect(host.textContent).toContain("Contact the event organizers.");
    expect(host.textContent).not.toContain("Pay for your ticket");
    expect(host.textContent).not.toContain("You're already registered");
  });
});
