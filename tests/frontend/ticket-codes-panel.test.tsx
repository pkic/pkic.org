// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import type { EventTicketsConfiguration } from "../../assets/shared/schemas/event-tickets";
import { TicketCodesPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/tickets/TicketCodesPanel";

let host: HTMLDivElement;

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
});

// The panel reads only the currency and the active tickets from the configuration.
const configuration = {
  settings: { currency: "usd" },
  types: [
    { id: "attendee", name: "Attendee", active: true },
    { id: "vendor", name: "Vendor", active: true },
  ],
} as unknown as EventTicketsConfiguration;

it("starts a new code from empty fields after the dialog was closed with Escape", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <TicketCodesPanel
        slug="synthetic"
        configuration={configuration}
        canWrite
        table={{ current: null }}
        loadCodes={async (_url, _signal, response) =>
          response.parse({ items: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })
        }
      />,
      host,
    ),
  );
  const open = () =>
    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Create code"], button[title="Create code"]')!.click(),
    );
  await open();
  const dialog = host.querySelector("dialog")!;
  const label = dialog.querySelector<HTMLInputElement>('input[name="label"]')!;
  const ticket = dialog.querySelector<HTMLSelectElement>('select[name="ticketTypeId"]')!;
  await act(() => {
    label.value = "Example partner";
    label.dispatchEvent(new Event("input", { bubbles: true }));
    ticket.value = "vendor";
    ticket.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Escape reaches the dialog as the platform's cancel event.
  await act(() => {
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  await open();
  expect(host.querySelector<HTMLInputElement>('dialog input[name="label"]')!.value).toBe("");
  expect(host.querySelector<HTMLSelectElement>('dialog select[name="ticketTypeId"]')!.value).toBe("attendee");
});
