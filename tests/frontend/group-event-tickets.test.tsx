// @vitest-environment jsdom
/**
 * The organizer's list of the tickets an event issued: totals from the
 * server's summary, each ticket with its payment, and an update from the
 * payment provider taken in batches until none is left.
 */
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issuedTicketsResponseSchema } from "../../assets/shared/schemas/event-issued-tickets";
import { GroupEventTickets } from "../../assets/ts/member-flows/portal/sections/management/GroupEventTickets";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/groups/g/events/e/registrations/tickets", vi.fn()],
}));

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const ticket = (overrides: Record<string, unknown>) => ({
  id: "20000000-0000-4000-8000-0000000000a1",
  ticketKey: "vendor",
  ticketName: "Vendor",
  source: "default",
  status: "paid",
  amount: 39500,
  currency: "usd",
  codeLabel: null,
  paidAt: "2027-01-05T10:00:00.000Z",
  disputed: false,
  disputeReason: null,
  refundPending: false,
  refundFailed: false,
  paymentReference: "pi_synthetic",
  refundedAmount: 0,
  paidAmount: 39500,
  ...overrides,
});

const list = () =>
  issuedTicketsResponseSchema.parse({
    tickets: [
      {
        registrationId: "20000000-0000-4000-8000-0000000000b1",
        name: "Alex Example",
        organizationName: "Example Corp",
        headshotUrl: null,
        payment: "paid",
        issuedAt: "2027-01-05T09:00:00.000Z",
        ticket: ticket({ paymentMethod: "ideal", netAmount: 38325 }),
      },
      {
        registrationId: "20000000-0000-4000-8000-0000000000b2",
        name: "Robin Placeholder",
        organizationName: null,
        headshotUrl: null,
        payment: "processing",
        issuedAt: "2027-01-06T09:00:00.000Z",
        ticket: ticket({
          id: "20000000-0000-4000-8000-0000000000a2",
          status: "pending_payment",
          paidAt: null,
          paidAmount: 0,
          paymentReference: null,
          paymentProcessing: true,
        }),
      },
    ],
    page: { limit: 50, offset: 0, total: 2, hasMore: false },
    summary: {
      currency: "usd",
      byPayment: { paid: 1, processing: 1 },
      collected: 39500,
      providerFees: 1175,
      refunded: 0,
      refundedCount: 0,
      awaitingAmount: 39500,
      unread: 0,
      updatable: 1,
    },
  });

afterEach(() => {
  for (const container of mounted.splice(0)) {
    render(null, container);
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event ticket list", () => {
  it("shows the totals and each ticket's payment, method and net amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(list()), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    const host = mount(
      <GroupEventTickets eventSlug="summit" registrationsPath="/groups/g/events/e/registrations" canManage />,
    );
    await settle();
    await settle();
    const text = host.textContent ?? "";
    expect(text).toContain("Collected$395");
    expect(text).toContain("Provider fees$11.75");
    expect(text).toContain("Net$383.25");
    expect(text).toContain("$395 open, 1 processing");
    expect(text).toContain("Net: $383.25");
    expect(text).toContain("iDEAL");
    expect(text).toContain("Payment processing");
    expect(host.querySelector('a[href$="/registrations/20000000-0000-4000-8000-0000000000b1"]')).not.toBeNull();
  });

  it("updates from the payment provider in batches until none is left", async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (init?.method === "POST" || (input instanceof Request && input.method === "POST")) {
          const body = input instanceof Request ? await input.text() : String(init?.body ?? "");
          posts.push(body);
          const first = posts.length === 1;
          return new Response(
            JSON.stringify({
              success: true,
              checked: first ? 8 : 1,
              changed: first ? 2 : 1,
              failed: 0,
              next: first ? "20000000-0000-4000-8000-0000000000a1" : null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        expect(url).toContain("/api/v1/events/summit/tickets/issued");
        return new Response(JSON.stringify(list()), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const host = mount(
      <GroupEventTickets eventSlug="summit" registrationsPath="/groups/g/events/e/registrations" canManage />,
    );
    await settle();
    await settle();
    const button = [...host.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === "Update from payment provider",
    )!;
    await act(async () => {
      button.click();
    });
    await settle();
    await settle();
    expect(posts.map((body) => JSON.parse(body))).toEqual([{}, { after: "20000000-0000-4000-8000-0000000000a1" }]);
  });
});
