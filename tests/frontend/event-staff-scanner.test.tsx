import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ScannerDestinationTiles } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerDestinationTiles";
import { EventStaffScanner } from "../../assets/ts/member-flows/portal/sections/management/EventStaffScanner";

vi.mock("../../assets/ts/member-flows/portal/sections/events/event-agenda-access", () => ({
  hasEventAgendaPermission: () => true,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgeLabelDesk", () => ({
  BadgeLabelDesk: () => null,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner", () => ({
  EventScanner: ({ printHref }: { printHref?: string }) => (
    <ScannerDestinationTiles
      allowedActions={["attendance", "checkout"]}
      printHref={printHref}
      disabled={false}
      onVenue={() => {}}
      onSessions={() => {}}
    />
  ),
}));

const host = document.createElement("div");
document.body.append(host);
afterEach(async () => {
  await act(() => render(null, host));
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
