// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { unfinishedRegistrationStopSchema } from "../../assets/shared/schemas/unfinished-registrations";
import { EventNotRegistering } from "../../assets/ts/member-flows/portal/sections/events/app/EventNotRegistering";
import { UnfinishedRegistrationsSummary } from "../../assets/ts/member-flows/portal/sections/events/detail/UnfinishedRegistrations";

let host: HTMLDivElement;
const stops: unknown[] = [];

async function mount(state: string) {
  stops.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/registrations/unfinished/current"))
        return Response.json({ eventName: "Synthetic Conference", state });
      if (url.endsWith("/registrations/unfinished/current/stop")) {
        stops.push(unfinishedRegistrationStopSchema.parse(JSON.parse(String(init?.body))));
        return Response.json({ success: true });
      }
      return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<EventNotRegistering slug="synthetic" />, host));
  await settle();
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

it("stops the reminders with the reason and note the person gives", async () => {
  await mount("unfinished");
  expect(host.textContent).toContain("Not registering for Synthetic Conference?");
  await act(() => host.querySelector<HTMLInputElement>('input[name="reasonCode"][value="price"]')!.click());
  const note = host.querySelector<HTMLTextAreaElement>('textarea[name="reasonNote"]')!;
  note.value = "Budget is frozen.";
  await act(() => {
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(stops).toEqual([{ reasonCode: "price", reasonNote: "Budget is frozen." }]);
  expect(host.textContent).toContain("We won’t remind you again");
  expect(host.querySelector<HTMLAnchorElement>('a[href="#/events/synthetic/register"]')?.textContent).toBe(
    "Register after all",
  );
});

it("stops the reminders without asking for a reason", async () => {
  await mount("unfinished");
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(stops).toEqual([{}]);
});

it("offers nothing to stop to a person who registered or never started", async () => {
  await mount("registered");
  expect(host.textContent).toContain("You’re registered for Synthetic Conference");
  expect(host.querySelector("form")).toBeNull();
  await act(() => render(null, host));
  host.remove();
  await mount("none");
  expect(host.textContent).toContain("There is nothing to stop");
  expect(host.querySelector("form")).toBeNull();
});

it("summarizes who stopped and why for the organizer", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <UnfinishedRegistrationsSummary
        summary={{
          started: 1200,
          registered: 900,
          reminded: 48,
          stopped: 34,
          reasons: [
            { reasonCode: "price", count: 14 },
            { reasonCode: null, count: 20 },
          ],
          notes: [{ reasonCode: "price", note: "Budget is frozen.", stoppedAt: "2027-03-02T10:00:00.000Z" }],
        }}
      />,
      host,
    ),
  );
  expect(host.textContent).toContain("1,200");
  expect(host.textContent).toContain("75% of those who started");
  expect(host.textContent).toContain("14 gave a reason");
  expect(host.textContent).toContain("No reason given");
  expect(host.textContent).toContain("Budget is frozen.");
});
