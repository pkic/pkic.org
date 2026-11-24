// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { AddEventSponsorDialog } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/sponsors/AddEventSponsorDialog";

let host: HTMLDivElement;

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

const EVENT_ID = "1adc0731-3780-4ef5-a4e9-489a66771b7b";

it("adds a sponsor of this event only, under the event", async () => {
  const requests: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/tiers"))
        return new Response(JSON.stringify({ tiers: [] }), { headers: { "content-type": "application/json" } });
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ error: "stop here" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(<AddEventSponsorDialog eventId={EVENT_ID} onClose={() => {}} onAdded={async () => {}} />, host),
  );
  const input = host.querySelector<HTMLInputElement>('input[name="nonMemberName"]')!;
  await act(() => {
    input.value = "Specimen Labs";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const add = [...host.querySelectorAll("button")].find((button) => button.textContent === "Add sponsor")!;
  await act(() => add.click());
  for (let turn = 0; turn < 5; turn += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(requests).toEqual([
    {
      url: "/api/v1/sponsors",
      body: expect.objectContaining({ sponsorType: "event", eventId: EVENT_ID, nonMemberName: "Specimen Labs" }),
    },
  ]);
});
