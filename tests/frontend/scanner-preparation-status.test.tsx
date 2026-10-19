import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { formatDateTime } from "../../assets/shared/format-date";
import { ScannerPreparationStatus } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerPreparationStatus";

const snapshot = { serverNow: "2026-12-01T09:00:00.000Z", expiresAt: "2026-12-01T09:15:00.000Z" };
describe("scanner snapshot status metadata", () => {
  it("shows the two server snapshot times through shared date formatting without claiming upload synchronization", () => {
    const html = render(
      <ScannerPreparationStatus action="attendance" preparing={false} ready error="" snapshot={snapshot} />,
    );
    expect(html).toContain("<dt>Last eligibility check</dt>");
    expect(html).toContain("<dt>Snapshot expires</dt>");
    expect(html).toContain(formatDateTime(snapshot.serverNow));
    expect(html).toContain(formatDateTime(snapshot.expiresAt));
    expect(html).toContain("These are server snapshot times");
    expect(html).not.toContain("Last upload");
    expect(html).not.toContain("Last sync");
  });
  it("shows actual successful sync separately from eligibility snapshot time, including an unavailable history state", () => {
    const lastSync = "2026-12-01T08:45:00.000Z";
    const html = render(
      <ScannerPreparationStatus
        action="check"
        preparing={false}
        ready
        error=""
        snapshot={snapshot}
        lastSync={lastSync}
      />,
    );
    expect(html).toContain("<dt>Last successful scan sync</dt>");
    expect(html).toContain(formatDateTime(lastSync));
    expect(html).toContain(formatDateTime(snapshot.serverNow));
    expect(html).toContain("Device-recorded time after a durable server acknowledgment");
    const empty = render(<ScannerPreparationStatus action="check" preparing={false} ready error="" lastSync={null} />);
    expect(empty).toContain("No retained acknowledgment");
    const unavailable = render(<ScannerPreparationStatus action="check" preparing={false} ready error="" />);
    expect(unavailable).toContain("Not available");
    expect(unavailable).not.toContain(formatDateTime(lastSync));
  });
  it("retains original timestamps when a refresh fails and marks saved eligibility as stale", () => {
    const html = render(
      <ScannerPreparationStatus
        action="attendance"
        preparing={false}
        ready
        stale
        error="Refresh unavailable"
        snapshot={snapshot}
      />,
    );
    expect(html).toContain("Using saved registration data");
    expect(html).toContain(formatDateTime(snapshot.serverNow));
    expect(html).toContain(formatDateTime(snapshot.expiresAt));
    expect(html).toContain("Later offline changes require a refresh");
  });
  it("does not invent a timestamp before a snapshot has been prepared", () => {
    const html = render(<ScannerPreparationStatus action="check" preparing={false} ready={false} error="" />);
    expect(html).toContain("Prepare eligibility data before scanning");
    expect(html).not.toContain("Last eligibility check");
    expect(html).not.toContain("Snapshot expires");
  });
});
