import { useContext } from "preact/hooks";
import { ScannerTaskNavigation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerTaskNavigation";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ScannerDestinationTiles } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerDestinationTiles";
import { EventStaffScanner } from "../../assets/ts/member-flows/portal/sections/management/EventStaffScanner";

const permissions = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/event-agenda-access", () => ({
  hasEventAgendaPermission: (_event: string, permission: string) => !permissions.denied.has(permission),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgeLabelDesk", () => ({
  BadgeLabelDesk: () => null,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner", () => ({
  EventScanner: ({ printHref }: { printHref?: string }) => {
    const navigation = useContext(ScannerTaskNavigation);
    return (
      <>
        <a aria-label="Entry destination" href={navigation?.tasks.find((task) => task.key === "entry")?.href} />
        <ScannerDestinationTiles
          allowedActions={["attendance", "checkout"]}
          printHref={printHref}
          disabled={false}
          onVenue={() => {}}
          onSessions={() => {}}
        />
      </>
    );
  },
}));

const host = document.createElement("div");
document.body.append(host);
afterEach(async () => {
  await act(() => render(null, host));
  permissions.denied.clear();
});
it.each([false, true])("gates the print destination at the staff scanner owner: %s", async (canPrintLabels) => {
  const basePath = "/groups/example/events/example/scanner";
  await act(async () => {
    render(
      <EventStaffScanner eventId="example" slug="example" basePath={basePath} canPrintLabels={canPrintLabels} />,
      host,
    );
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(host.querySelectorAll(".pk-action-tile").length).toBeGreaterThan(0));
  const link = host.querySelector(`a[href="#${basePath}/print"]`);
  expect(Boolean(link)).toBe(canPrintLabels);
});

it("links Entry to admission when attendance is unavailable and check is the default", async () => {
  permissions.denied.add("agenda:attendance_record");
  permissions.denied.add("agenda:scan");
  const basePath = "/groups/example/events/example/scanner";
  await act(async () => render(<EventStaffScanner eventId="example" slug="example" basePath={basePath} />, host));
  await vi.waitFor(() =>
    expect(host.querySelector('a[aria-label="Entry destination"]')?.getAttribute("href")).toBe(
      `#${basePath}?scanAction=admission`,
    ),
  );
});
