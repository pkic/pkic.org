import type { ComponentProps } from "preact";
import { clearAuth, savePortalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { memoryStorage } from "./helpers/browser-storage";
import { useContext } from "preact/hooks";
import { ScannerTaskNavigation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerTaskNavigation";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ScannerDestinationTiles } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerDestinationTiles";
import { EventStaffScanner } from "../../assets/ts/member-flows/portal/sections/management/EventStaffScanner";

let observedNavigation: ComponentProps<typeof ScannerTaskNavigation.Provider>["value"] = null;
const permissions = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/event-agenda-access", () => ({
  hasEventAgendaPermission: (_event: string, permission: string) => !permissions.denied.has(permission),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgeLabelDesk", () => ({
  BadgeLabelDesk: () => {
    observedNavigation = useContext(ScannerTaskNavigation);
    return null;
  },
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner", () => ({
  EventScanner: ({ printHref }: { printHref?: string }) => {
    const navigation = useContext(ScannerTaskNavigation);
    observedNavigation = navigation;
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
  observedNavigation = null;
  clearAuth();
  vi.unstubAllGlobals();
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

it("transfers a current badge only to the authorized print desk and consumes it once", async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  savePortalSession(portalSessionFixture({ member: true }));
  const basePath = "/groups/example/events/example/scanner";
  const credential = "ABCDEFGHJKLMNPQR";
  const mount = (section?: string, canPrintLabels = true) =>
    render(
      <EventStaffScanner
        eventId="example"
        slug="example"
        basePath={basePath}
        section={section}
        canPrintLabels={canPrintLabels}
      />,
      host,
    );
  await act(async () => mount());
  await vi.waitFor(() => expect(observedNavigation?.onPrintBadge).toBeDefined());
  await act(() => {
    observedNavigation?.onPrintBadge?.(credential);
  });
  expect(window.location.hash).toBe(`#${basePath}/print`);
  expect(window.location.hash).not.toContain(credential);
  await act(async () => mount("print"));
  expect(observedNavigation?.consumePrintBadge?.()).toBe(credential);
  expect(observedNavigation?.consumePrintBadge?.()).toBeNull();
  await act(async () => mount(undefined, false));
  expect(observedNavigation?.onPrintBadge).toBeUndefined();
});

it("discards an unconsumed badge when the operator session changes", async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  const session = portalSessionFixture({ member: true });
  savePortalSession(session);
  const mount = (section?: string) =>
    render(
      <EventStaffScanner
        eventId="example"
        slug="example"
        basePath="/groups/example/events/example/scanner"
        section={section}
        canPrintLabels
      />,
      host,
    );
  await act(async () => mount());
  await vi.waitFor(() => expect(observedNavigation?.onPrintBadge).toBeDefined());
  await act(() => {
    observedNavigation?.onPrintBadge?.("ABCDEFGHJKLMNPQR");
  });
  savePortalSession({ ...session, sessionId: crypto.randomUUID() });
  await act(async () => mount("print"));
  expect(observedNavigation?.consumePrintBadge?.()).toBeNull();
});

it("discards an unconsumed badge when leaving the print desk", async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  savePortalSession(portalSessionFixture({ member: true }));
  const mount = (section?: string) =>
    render(
      <EventStaffScanner
        eventId="example"
        slug="example"
        basePath="/groups/example/events/example/scanner"
        section={section}
        canPrintLabels
      />,
      host,
    );
  await act(async () => mount());
  await vi.waitFor(() => expect(observedNavigation?.onPrintBadge).toBeDefined());
  await act(() => {
    observedNavigation?.onPrintBadge?.("ABCDEFGHJKLMNPQR");
  });
  await act(async () => mount("print"));
  await act(async () => mount());
  await act(async () => mount("print"));
  expect(observedNavigation?.consumePrintBadge?.()).toBeNull();
});
