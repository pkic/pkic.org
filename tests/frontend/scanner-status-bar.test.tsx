import { render } from "preact-render-to-string";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as mount } from "preact";
import { act } from "preact/test-utils";
import { formatDateTime } from "../../assets/shared/format-date";
import { ScannerConnectionStatus } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerConnectionStatus";

describe("scanner status bar", () => {
  const now = Date.parse("2026-12-01T12:00:00.000Z");
  beforeEach(() => {
    vi.useFakeTimers({ now });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("combines readiness, offline availability, pending scans and actual last sync", () => {
    const lastSync = "2026-12-01T08:45:00.000Z";
    const html = render(
      <ScannerConnectionStatus
        pending={3}
        online
        syncing={false}
        lastSync={lastSync}
        offlinePrepared
        preparation={{ preparing: false, ready: true, error: "" }}
      />,
    );
    expect(html).toContain('aria-label="Scanner status"');
    expect(html).toContain("Badge data ready");
    expect(html).not.toContain("Ready to scan");
    expect(html).toContain("Online");
    expect(html).not.toContain("online only");
    expect(html).toContain("3 h ago");
    expect(html).toContain("3 awaiting upload");
    expect(html).toContain(formatDateTime(lastSync));
    expect(html).toContain(`datetime="${lastSync}"`);
  });
  it("shows initial download progress without interrupting an already ready scanner", () => {
    const props = { pending: 0, online: true, syncing: false, offlinePrepared: false };
    const preparing = render(
      <ScannerConnectionStatus
        {...props}
        preparation={{ preparing: true, ready: false, error: "", checkedBadges: 250, badgeCollection: true }}
      />,
    );
    expect(preparing).toContain("Preparing badge names");
    expect(preparing).toContain("250 badges checked");
    const ready = render(
      <ScannerConnectionStatus
        {...props}
        preparation={{ preparing: true, ready: true, error: "", checkedBadges: 250 }}
      />,
    );
    expect(ready).toContain("Badge data ready");
    expect(ready).toContain("Keep open to scan offline");
    expect(ready).not.toContain("online only");
    expect(ready).not.toContain("250 badges checked");
  });
  it.each([
    [30_000, "just now"],
    [5 * 60_000, "5 min ago"],
    [2 * 60 * 60_000, "2 h ago"],
    [12 * 60 * 60_000 - 1_000, "11 h ago"],
    [12 * 60 * 60_000, null],
    [24 * 60 * 60_000, null],
  ])("uses relative sync age below twelve hours and exact time afterward (%s ms)", (age, relative) => {
    const lastSync = new Date(now - age).toISOString();
    const exact = formatDateTime(lastSync);
    const html = render(<ScannerConnectionStatus pending={0} online syncing={false} lastSync={lastSync} />);
    expect(html).toContain(`datetime="${lastSync}"`);
    expect(html).toContain(`title="${exact}"`);
    expect(html).toContain(`aria-label="${exact}"`);
    expect(html).toContain(`>${relative ?? exact}</time>`);
  });
  it("updates relative sync age once a minute and clears the refresh timer on unmount", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      mount(
        <ScannerConnectionStatus pending={0} online syncing={false} lastSync={new Date(now).toISOString()} />,
        host,
      ),
    );
    expect(host.textContent).toContain("Last synced just now");
    await act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(host.textContent).toContain("Last synced 1 min ago");
    await act(() => mount(null, host));
    expect(vi.getTimerCount()).toBe(0);
    host.remove();
  });
  it("does not claim complete name coverage when preparation is partial", () => {
    const html = render(
      <ScannerConnectionStatus
        pending={0}
        online={false}
        syncing={false}
        offlinePrepared
        lastSync={null}
        preparation={{ preparing: false, ready: true, error: "", badgeCollection: true, badgeNamesPrepared: false }}
      />,
    );
    expect(html).toContain("Some badge names unavailable offline");
    expect(html).toContain("Offline");
    expect(html).toContain("No recent sync");
  });
  it("uses a compact sync mark during scanning and shows only actionable status text", () => {
    const ready = render(
      <ScannerConnectionStatus
        compact
        pending={0}
        online
        syncing={false}
        offlinePrepared
        preparation={{ preparing: false, ready: true, error: "", badgeCollection: true, badgeNamesPrepared: true }}
      />,
    );
    expect(ready).toContain('title="All scans synced"');
    expect(ready).not.toContain("Badge names ready");
    expect(ready).not.toContain("No recent sync");
    const notSaved = render(
      <ScannerConnectionStatus
        compact
        pending={0}
        online
        syncing={false}
        offlinePrepared={false}
        preparation={{ preparing: false, ready: true, error: "" }}
      />,
    );
    expect(notSaved).toContain("Keep open to scan offline");
    expect(notSaved).not.toContain('title="All scans synced"');
    const offline = render(
      <ScannerConnectionStatus compact pending={1} online={false} syncing={false} offlinePrepared />,
    );
    expect(offline).toContain("Offline · 1 awaiting upload");
    const failed = render(
      <ScannerConnectionStatus compact pending={0} online syncing={false} error="Scan upload failed" />,
    );
    expect(failed).toContain("Scan upload failed");
  });
});
