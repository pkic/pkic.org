// @vitest-environment jsdom
import { menuPath } from "./helpers/menu-path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, it, expect, vi } from "vitest";
import { groupEventRegistrationExportQuerySchema } from "../../assets/shared/schemas/group-event-registration-operations";
import { eventAttendanceRegistrationsQuerySchema } from "../../assets/shared/schemas/event-registrations";
import { dateTimeLocalToIso, viewerTimeZone } from "../../assets/shared/timezone";
import { GroupEventRegistrations } from "../../assets/ts/member-flows/portal/sections/management/GroupEventRegistrations";
import { registrationRosterExportUrl } from "../../assets/ts/components/event-registrations/registration-roster-export";
import { openColumnFilterMenu } from "./helpers/column-menu";
import { menuItemNamed } from "./helpers/row-actions";
import { controlFor } from "./helpers/labeled-control";
import { GROUP_ID, EVENT_ID, json, registrationList } from "./helpers/group-event-attendance-fixtures";
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
let host: HTMLDivElement | undefined;
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
  const container = document.createElement("div");
  host = container;
  document.body.append(container);
  void act(() => render(node, container));
  return container;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
afterEach(async () => {
  const mounted = host;
  host = undefined;
  if (mounted) {
    await act(async () => render(null, mounted));
    mounted.remove();
  }
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
  const link = (await menuPath(container, "Registration actions", [
    "Download",
    "CSV",
    "Attendees",
  ])) as HTMLAnchorElement;
  const exported = groupEventRegistrationExportQuerySchema.parse(Object.fromEntries(new URL(link.href).searchParams));
  expect(exported.created_since).toBe(query.created_since);
  expect(location.hash).toContain("registrations.f.created_since");
});

it("keeps the roster available and disables CSV export for an invalid restored filter", async () => {
  history.replaceState({}, "", "/#/registrations?registrations.f.created_since=yesterday");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ error: { message: "Invalid start date" } }, 400)),
  );
  const container = mount(<GroupEventRegistrations groupId={GROUP_ID} eventId={EVENT_ID} canManage />);
  await settle();
  const download = await menuPath(container, "Registration actions", ["Download", "CSV", "Attendees"]);
  expect((download as HTMLButtonElement).disabled).toBe(true);
  expect(download.getAttribute("href")).toBeNull();
  expect(container.querySelector('input[type="search"]')).not.toBeNull();
});

it.each(["", "registered", "cancelled"])(
  "discloses the CSV scope for the restored status filter %j",
  async (status) => {
    history.replaceState({}, "", `/#/registrations?registrations.f.status=${status}`);
    installApi(false);
    const container = mount(<GroupEventRegistrations groupId={GROUP_ID} eventId={EVENT_ID} canManage />);
    await settle();
    const download = (await menuPath(container, "Registration actions", [
      "Download",
      "CSV",
      "Attendees",
    ])) as HTMLAnchorElement;
    const scope = groupEventRegistrationExportQuerySchema.parse(
      Object.fromEntries(new URL(download.href).searchParams),
    );
    expect(scope.status).toBe(status || undefined);
  },
);

it.each<{ query: Record<string, string>; ids?: string[] }>([
  { query: { created_since: "yesterday" }, ids: undefined },
  { query: { status: "unknown" }, ids: undefined },
  { query: {}, ids: ["not-a-registration-id"] },
  { query: {}, ids: [] },
])("refuses invalid CSV scopes instead of exporting an unfiltered population: %j", ({ query, ids }) => {
  expect(registrationRosterExportUrl("/registrations/exports", query, ids)).toBeNull();
});
