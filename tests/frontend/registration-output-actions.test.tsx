// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { RegistrationOutputActions } from "../../assets/ts/components/event-registrations/RegistrationOutputActions";
import { SponsorConsentCell } from "../../assets/ts/components/event-registrations/SponsorConsentCell";
import { menuPath } from "./helpers/menu-path";

let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
});
async function mount(node: preact.ComponentChildren) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(node, host!));
  return host;
}

it("offers only attendee CSV when the caller cannot print or export sponsor data", async () => {
  const container = await mount(<RegistrationOutputActions attendeeUrl="/attendees.csv" />);
  const item = await menuPath(container, "Actions for matching attendees", ["Download", "CSV", "Attendees"]);
  expect(item.getAttribute("href")).toBe("/attendees.csv");
  const choices = [...container.querySelectorAll('[role="menuitem"]')].map((entry) =>
    entry.textContent?.replace(/\s*›$/, "").trim(),
  );
  expect(choices).toEqual(["Download", "CSV", "Attendees"]);
});

it("keeps supported outputs disabled for an invalid scope instead of offering an unfiltered download", async () => {
  const container = await mount(<RegistrationOutputActions attendeeUrl={null} sponsorUrl={null} onPrint={vi.fn()} />);
  for (const path of [
    ["Print", "Labels"],
    ["Download", "PDF", "Badges"],
    ["Download", "CSV", "Attendees with consent"],
  ]) {
    const item = await menuPath(container, "Actions for matching attendees", path);
    expect(item).toBeInstanceOf(HTMLButtonElement);
    expect((item as HTMLButtonElement).disabled).toBe(true);
  }
});

it.each([
  [true, "Consented to share with sponsors"],
  [false, "No sponsor consent"],
  [null, "Not asked"],
] as const)("announces consent %s as text while keeping its mark decorative", async (consent, label) => {
  const container = await mount(<SponsorConsentCell consent={consent} />);
  expect(container.querySelector(".pk-sr-only")?.textContent).toBe(label);
  expect(container.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe(consent ? "✓" : "—");
});
