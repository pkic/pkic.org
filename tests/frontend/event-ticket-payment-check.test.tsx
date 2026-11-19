/**
 * The ticket page asks the payment provider once when it opens on an unpaid
 * ticket, so a person back from the payment page is not asked to pay again
 * while the provider's own notice is still on its way.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrationTicketSchema } from "../../assets/shared/schemas/event-tickets";
import { EventTicketPayment } from "../../assets/ts/member-flows/portal/sections/events/app/EventTicketPayment";

const postJson = vi.hoisted(() => vi.fn());
vi.mock("../../assets/ts/shared/api-client", () => ({ postJson }));

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
});

afterEach(() => {
  render(null, host);
  host.remove();
});

async function open(onSettled = vi.fn()) {
  await act(async () => {
    render(
      <EventTicketPayment
        slug="summit"
        registrationId={registrationId}
        ticket={ticket}
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
});
