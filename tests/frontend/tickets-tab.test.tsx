// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { EventTicketsConfiguration } from "../../assets/shared/schemas/event-tickets";
import { TicketsTab } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketsTab";

const state = vi.hoisted(() => ({ configuration: null as unknown }));

vi.mock("../../assets/ts/hooks/useData", () => ({
  useData: () => ({ data: state.configuration, loading: false, error: null, reload: async () => {} }),
}));
// The tab's own panels have their own tests; here they only show whether the tab renders them.
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketCodesPanel", () => ({
  TicketCodesPanel: () => <section aria-label="Codes" />,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/SponsorPassesPanel", () => ({
  SponsorPassesPanel: () => null,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketStepTextsPanel", () => ({
  TicketStepTextsPanel: () => null,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketPaymentPanel", () => ({
  TicketPaymentPanel: () => null,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketTypeEditor", () => ({
  TicketTypeEditor: ({ type }: { type?: { name: string } }) => (
    <section aria-label={`Edit ticket: ${type?.name ?? ""}`} />
  ),
}));

let host: HTMLDivElement;

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
});

function configuration(underReviewCount: number): EventTicketsConfiguration {
  return {
    revision: "1",
    timeZone: "UTC",
    settings: { currency: "usd" },
    currentPeriodId: null,
    types: [
      {
        id: "attendee",
        key: "attendee",
        name: "Attendee",
        descriptionMarkdown: "",
        classifierDescription: "",
        classifierThresholdPercent: 75,
        active: true,
        isDefault: true,
        freeRequiresWorkEmail: false,
        presetOrganizations: 0,
        registered: 0,
        paid: 0,
        awaitingPayment: 0,
        underReview: 0,
      },
    ],
    periods: [],
    prices: [],
    totals: {
      collected: 0,
      paidCount: 0,
      underReviewCount,
      underReviewAmount: underReviewCount * 39500,
      awaitingAmount: 0,
      awaitingCount: 0,
      freeCount: 3,
    },
  } as unknown as EventTicketsConfiguration;
}

async function renderTab(
  canWrite: boolean,
  underReviewCount = 0,
  section?: "tickets" | "codes" | "payments",
  detail?: string,
  segment?: string,
) {
  state.configuration = configuration(underReviewCount);
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <TicketsTab slug="synthetic" canWrite={canWrite} section={section} detail={detail} segment={segment} />,
      host,
    ),
  );
}

it("shows codes on their own tab, only to an organizer who can change them", async () => {
  await renderTab(true);
  expect(host.querySelector('[aria-label="Codes"]')).toBeNull();
  await act(() => render(null, host));
  host.remove();

  await renderTab(false, 0, "codes");
  expect(host.querySelector('[aria-label="Codes"]')).toBeNull();
  await act(() => render(null, host));
  host.remove();

  await renderTab(true, 0, "codes");
  expect(host.querySelector('[aria-label="Codes"]')).not.toBeNull();
});

it("shows payments under review only when there are some", async () => {
  await renderTab(true);
  expect(host.textContent).not.toContain("Payment under review");
  await act(() => render(null, host));
  host.remove();

  await renderTab(true, 1);
  expect(host.textContent).toContain("Payment under review");
});

it("opens a ticket to read first, with its editor one page below", async () => {
  await renderTab(true, 0, "tickets", "attendee");
  expect(host.querySelector('[aria-label="Attendee ticket"]')).not.toBeNull();
  expect(host.querySelector<HTMLAnchorElement>("a[href$='/tickets/attendee/edit']")?.textContent).toBe("Edit ticket");
  await act(() => render(null, host));
  host.remove();

  await renderTab(true, 0, "tickets", "attendee", "edit");
  expect(host.querySelector('[aria-label="Edit ticket: Attendee"]')).not.toBeNull();
  await act(() => render(null, host));
  host.remove();

  // Someone who cannot change tickets reads the ticket, and the editor stays closed.
  await renderTab(false, 0, "tickets", "attendee", "edit");
  expect(host.querySelector('[aria-label="Attendee ticket"]')).not.toBeNull();
  expect(host.querySelector("a[href$='/edit']")).toBeNull();
});
