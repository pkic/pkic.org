// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { EventTicketsConfiguration } from "../../assets/shared/schemas/event-tickets";
import { eventTicketOrganizationTrialSchema } from "../../assets/shared/schemas/event-ticket-organizations";
import { TicketOrganizationDialog } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketOrganizationDialog";
import { TicketOrganizationsPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketOrganizationsPanel";

let host: HTMLDivElement;

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

// The panel and the dialog read only the tickets from the configuration.
const configuration = {
  types: [
    { id: "attendee", key: "attendee", name: "Attendee", active: true, isDefault: true, classifierDescription: "x" },
    { id: "vendor", key: "vendor", name: "Vendor", active: true, isDefault: false, classifierDescription: "x" },
  ],
} as unknown as EventTicketsConfiguration;

function mount(node: preact.ComponentChild) {
  host = document.createElement("div");
  document.body.append(host);
  return act(() => render(node, host));
}

it("lists each organization's ticket and who decided it", async () => {
  await mount(
    <TicketOrganizationsPanel
      slug="synthetic"
      configuration={configuration}
      onChanged={async () => {}}
      loadOrganizations={async (_url, _signal, response) =>
        response.parse({
          organizations: [
            {
              id: "b4f0c1de-0000-4000-8000-000000000001",
              organizationId: "c1a5517e-0000-4000-8000-000000000001",
              organizationName: "Example Bank",
              domains: ["examplebank.test", "examplebank-group.test"],
              ticketKey: "attendee",
              decidedBy: "classifier",
              confidencePercent: 94,
              updatedAt: "2026-11-20T09:30:00.000Z",
            },
            {
              id: "b4f0c1de-0000-4000-8000-000000000002",
              organizationId: "c1a5517e-0000-4000-8000-000000000002",
              organizationName: "Sample Security",
              domains: [],
              ticketKey: "vendor",
              decidedBy: "organizer",
              confidencePercent: null,
              updatedAt: "2026-11-20T09:30:00.000Z",
            },
          ],
          page: { limit: 25, offset: 0, total: 2, hasMore: false },
        })
      }
    />,
  );
  await act(async () => {});
  const text = host.textContent ?? "";
  expect(text).toContain("Example Bank");
  expect(text).toContain("examplebank.test, examplebank-group.test");
  expect(text).toContain("Classifier, 94% sure");
  expect(text).toContain("Organizer");
  expect(text).toContain("Vendor");
});

function answering(requests: unknown[], result: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          results: [
            {
              answers: [
                { ticketKey: "vendor", percent: 58, thresholdPercent: 75 },
                { ticketKey: "attendee", percent: 42, thresholdPercent: 75 },
              ],
              decidedTicketKey: null,
              current: null,
              error: null,
              ...result,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
}

// The answer arrives and is read after a few turns of the event loop.
async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

it("tests a portal organization by its own domains and offers to save the likeliest ticket", async () => {
  const requests: unknown[] = [];
  const organizationId = "c1a5517e-0000-4000-8000-000000000003";
  answering(requests, { organizationId, organizationName: "Specimen Systems", domains: ["specimen.test"] });
  await mount(
    <TicketOrganizationDialog
      slug="synthetic"
      tickets={configuration.types}
      classifierOn
      start={{ organizationId, organizationName: "Specimen Systems", domains: ["specimen.test"], testOnOpen: true }}
      onClose={() => {}}
      onSaved={async () => {}}
    />,
  );
  await settle();
  expect(requests).toHaveLength(1);
  expect(eventTicketOrganizationTrialSchema.parse(requests[0])).toEqual({ organizations: [{ organizationId }] });
  const dialog = host.querySelector("dialog")!;
  expect(dialog.textContent).toContain("specimen.test");
  expect(dialog.querySelector('input[name="organizationName"]')).toBeNull();
  expect(dialog.textContent).toContain("Classifier: 58% sure");
  expect(dialog.textContent).toContain("No ticket reaches its threshold.");
  expect(dialog.querySelector<HTMLInputElement>('input[name="ticketKey"][value="vendor"]')!.checked).toBe(true);
  expect(dialog.textContent).toContain("Save Vendor");
});

it("tests a typed organization without offering to save it", async () => {
  const requests: unknown[] = [];
  answering(requests, { organizationId: null, organizationName: "Specimen Systems", domains: [] });
  await mount(
    <TicketOrganizationDialog
      slug="synthetic"
      tickets={configuration.types}
      classifierOn
      start={{ organizationName: "Specimen Systems", domains: ["gmail.com"], testOnOpen: true }}
      onClose={() => {}}
      onSaved={async () => {}}
    />,
  );
  await settle();
  expect(eventTicketOrganizationTrialSchema.parse(requests[0])).toEqual({
    organizations: [{ organizationName: "Specimen Systems", domains: ["gmail.com"] }],
  });
  const dialog = host.querySelector("dialog")!;
  expect(dialog.textContent).toContain("Personal mail domains were left out of the test.");
  expect(dialog.querySelector('input[name="ticketKey"]')).toBeNull();
  expect(dialog.textContent).not.toContain("Save Vendor");
});
