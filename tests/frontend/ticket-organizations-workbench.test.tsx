// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { EventTicketsConfiguration } from "../../assets/shared/schemas/event-tickets";
import { TicketOrganizationsWorkbench } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketOrganizationsWorkbench";

let host: HTMLDivElement;

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

const configuration = {
  types: [
    { id: "attendee", key: "attendee", name: "Attendee", active: true, isDefault: true, classifierDescription: "x" },
    { id: "vendor", key: "vendor", name: "Vendor", active: true, isDefault: false, classifierDescription: "x" },
  ],
} as unknown as EventTicketsConfiguration;

const organization = (id: string, name: string, domain: string) => ({
  id: null,
  organizationId: id,
  organizationName: name,
  emailDomain: domain,
  ticketKey: null,
  decidedBy: null,
  confidencePercent: null,
  updatedAt: null,
});

const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

it("tests the checked organizations together and saves only the answers that decide a ticket", async () => {
  const requests: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      const body = url.endsWith("/trials")
        ? {
            results: [
              {
                organizationName: "Example Bank",
                emailDomain: "examplebank.test",
                answers: [
                  { ticketKey: "attendee", percent: 91, thresholdPercent: 75 },
                  { ticketKey: "vendor", percent: 9, thresholdPercent: 75 },
                ],
                decidedTicketKey: "attendee",
                current: null,
                error: null,
              },
              {
                organizationName: "Sample Security",
                emailDomain: null,
                answers: [
                  { ticketKey: "vendor", percent: 60, thresholdPercent: 75 },
                  { ticketKey: "attendee", percent: 40, thresholdPercent: 75 },
                ],
                decidedTicketKey: null,
                current: null,
                error: null,
              },
            ],
          }
        : { success: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <TicketOrganizationsWorkbench
        slug="synthetic"
        configuration={configuration}
        onChanged={async () => {}}
        loadOrganizations={async (url, _signal, response) => {
          expect(url).toContain("among=portal");
          return response.parse({
            organizations: [
              organization("b4f0c1de-0000-4000-8000-000000000001", "Example Bank", "examplebank.test"),
              organization("b4f0c1de-0000-4000-8000-000000000002", "Sample Security", ""),
            ],
            page: { limit: 25, offset: 0, total: 2, hasMore: false },
          });
        }}
      />,
      host,
    ),
  );
  await settle();
  expect(host.textContent).toContain("Not decided");
  const box = host.querySelector<HTMLInputElement>('input[aria-label="Select all rows"]')!;
  await act(() => box.click());
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
  await act(() => button("Test selected").click());
  await settle();
  expect(requests[0]!.body).toEqual({
    organizations: [
      { organizationName: "Example Bank", emailDomain: "examplebank.test" },
      { organizationName: "Sample Security" },
    ],
  });
  expect(host.textContent).toContain("Attendee, 91% sure");
  expect(host.textContent).toContain("Not sure enough: Vendor, 60%");
  await act(() => button("Save test answers").click());
  await settle();
  expect(requests[1]!.url).toContain("/organizations/decisions");
  expect(requests[1]!.body).toEqual({
    decisions: [{ organizationName: "Example Bank", emailDomain: "examplebank.test", ticketKey: "attendee" }],
  });
});
