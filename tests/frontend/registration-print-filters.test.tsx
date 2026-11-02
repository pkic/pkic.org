// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, it, expect, vi } from "vitest";
import { groupEventRegistrationExportQuerySchema } from "../../assets/shared/schemas/group-event-registration-operations";
import { eventAttendanceRegistrationsQuerySchema } from "../../assets/shared/schemas/event-registrations";
import { dateTimeLocalToIso, viewerTimeZone } from "../../assets/shared/timezone";
import { GroupEventRegistrations } from "../../assets/ts/member-flows/portal/sections/management/GroupEventRegistrations";
import { openColumnFilterMenu } from "./helpers/column-menu";
import { menuItemNamed } from "./helpers/row-actions";
import { controlFor } from "./helpers/labeled-control";
import { GROUP_ID, EVENT_ID, json, registrationList } from "./helpers/group-event-attendance-fixtures";
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
let host: HTMLDivElement;
function installApi(_waitlisted: boolean) {
  const requests: Array<{ search: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      eventAttendanceRegistrationsQuerySchema.parse(Object.fromEntries(url.searchParams));
      requests.push({ search: url.search });
      return json(registrationList());
    }),
  );
  return requests;
}
function mount(node: preact.ComponentChildren) {
  host = document.createElement("div");
  document.body.append(host);
  void act(() => render(node, host));
  return host;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
afterEach(async () => {
  await act(async () => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
});
it("applies a local start time through the shared contract and includes that UTC boundary in CSV export", async () => {
  const requests = installApi(false);
  const container = mount(
    <GroupEventRegistrations
      groupId={GROUP_ID}
      eventId={EVENT_ID}
      eventSlug="architecture-workshop"
      canManage
      onPrint={vi.fn()}
    />,
  );
  await settle();
  openColumnFilterMenu(container, "Registered");
  await act(async () => menuItemNamed(container, "Choose start date…")!.click());
  const apply = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Apply filter",
  )!;
  await act(async () => apply.click());
  const input = controlFor<HTMLInputElement>(container, "Start date and time");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  await act(async () => {
    input.value = "2026-11-01T00:00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => apply.click());
  await settle();
  const query = eventAttendanceRegistrationsQuerySchema.parse(
    Object.fromEntries(new URLSearchParams(requests.at(-1)!.search)),
  );
  expect(query.created_since).toBe(dateTimeLocalToIso("2026-11-01T00:00", viewerTimeZone()));
  const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Download registrations (CSV)"]')!;
  const exported = groupEventRegistrationExportQuerySchema.parse(Object.fromEntries(new URL(link.href).searchParams));
  expect(exported.created_since).toBe(query.created_since);
  expect(location.hash).toContain("registrations.f.created_since");
});
