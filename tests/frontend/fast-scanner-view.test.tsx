import { ScannerModeSelect } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerModeSelect";
import { availableScannerActions } from "../../assets/shared/event-scanner-permissions";
import { formatDateTime } from "../../assets/shared/format-date";
import { ScannerFeedback } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerFeedback";
// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { describe, it, expect, vi, afterEach } from "vitest";
import { FastScannerView } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/FastScannerView";
import {
  enterScannerFullscreen,
  scannerImmersiveLifecycle,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/immersive-scanner";
import {
  eventScanResponseSchema,
  eventScanRequestSchema,
} from "../../assets/shared/schemas/event-participation-scanning";

const props = {
  context: "Main hall · Session admission",
  pending: 0,
  message: "Ready",
  cameraActive: true,
  preview: false,
  onPreview: () => {},
  onExit: () => {},
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("shared supporting scanner warning labels", () => {
  it.each([
    ["wrong_location", "Known badge · location notice"],
    ["wrong_attendance_mode", "Known badge · attendance notice"],
    ["missing_registration", "Known badge · not registered"],
  ] as const)("renders %s honestly in both scanner views", (reason, label) => {
    const result = eventScanResponseSchema.parse({
      operationId: "44444444-4444-4444-8444-444444444444",
      outcome: "warning",
      reason,
      recorded: true,
      attendanceRecorded: true,
    });
    for (const html of [
      render(<FastScannerView {...props} mode="attendance" result={result} />),
      render(<ScannerFeedback result={result} action="attendance" message="Observation captured" pending={0} />),
    ]) {
      expect(html).toContain(label);
      expect(html).not.toContain("Do not admit");
      if (reason !== "missing_registration") expect(html).not.toContain("not registered");
    }
  });
});
describe("continuous scanner presentation", () => {
  it("offers admission only with its existing action capability and keeps sponsor capture separate", () => {
    for (const permission of ["agenda:check", "agenda:admit"] as const) {
      const actions = availableScannerActions((value) => value === permission);
      const html = render(
        <ScannerModeSelect action={actions[0]!} allowedActions={actions} actionField={{}} onAction={() => {}} />,
      );
      expect(html.includes("Admission decision")).toBe(permission === "agenda:admit");
      expect(html.includes("Check registration only")).toBe(permission === "agenda:check");
    }
    const html = render(
      <ScannerModeSelect
        action="lead"
        sponsorId="sponsor"
        allowedActions={["lead", "admission"]}
        actionField={{}}
        onAction={() => {}}
      />,
    );
    expect(html).toContain("Capture sponsor lead");
    expect(html).not.toContain("Admission decision");
  });
  it.each([false, true])(
    "never treats cached eligibility or a decision-less acknowledgment as admission (%s)",
    (recorded) => {
      const result = eventScanResponseSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        outcome: "eligible",
        reason: "eligible",
        recorded,
        attendanceRecorded: false,
      });
      const label = recorded ? "Admission decision not recorded" : "Admission decision pending";
      for (const html of [
        render(<FastScannerView {...props} mode="admission" result={result} />),
        render(<ScannerFeedback result={result} action="admission" message="" pending={recorded ? 0 : 1} />),
      ]) {
        expect(html).toContain(label);
        expect(html).not.toContain("Admission allowed");
        expect(html).not.toContain("--eligible");
        expect(html).toContain("--unverified");
      }
      expect(render(<ScannerFeedback result={result} action="check" message="" pending={0} />)).toContain("--eligible");
    },
  );

  it.each([
    ["allowed", "warning", "eligible", "Known badge · location notice"],
    ["refused", "eligible", "denied", "Registered"],
    ["unresolved", "eligible", "unverified", "Registered"],
  ] as const)(
    "shows %s without confusing eligibility, attendance or upload success",
    (admissionDecision, outcome, tone, eligibility) => {
      const result = eventScanResponseSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        outcome,
        reason: "wrong_location",
        recorded: true,
        attendanceRecorded: false,
        admissionRecorded: true,
        admissionDecision,
      });
      const fast = render(
        <FastScannerView {...props} mode="admission" result={result} uploadStatus="All pending scans uploaded." />,
      );
      const normal = render(<ScannerFeedback result={result} action="admission" message="" pending={0} />);
      for (const html of [fast, normal]) {
        expect(html).toContain(`Admission ${admissionDecision}`);
        expect(html).toContain(eligibility);
        expect(html).toContain("Not recorded");
        expect(html).not.toContain("attendance recorded");
      }
      expect(fast).toContain(`pk-fast-scanner--${tone}`);
      expect(normal).toContain(`pk-event-scanner--${tone}`);
    },
  );

  it("reuses the snapshot status and timestamps in the existing operator drawer", () => {
    const snapshot = { serverNow: "2026-12-01T09:00:00.000Z", expiresAt: "2026-12-01T09:15:00.000Z" };
    const html = render(
      <FastScannerView
        {...props}
        result={null}
        preparation={{ action: "attendance", preparing: false, ready: true, stale: true, error: "", snapshot }}
      />,
    );
    expect(html).toContain("Scanner operator controls");
    expect(html).toContain("Using saved registration data");
    expect(html).toContain("Last eligibility check");
    expect(html).toContain("Snapshot expires");
    expect(html).toContain(formatDateTime(snapshot.serverNow));
    expect(html).toContain(formatDateTime(snapshot.expiresAt));
    expect(html).not.toContain("Last sync");
  });

  it.each(["lead", "checkout"] as const)("does not turn a %s refusal into an admission exception", (mode) => {
    const request = eventScanRequestSchema.parse({
      operatorUserId: "00000000-0000-4000-8000-000000000001",
      operationId: "00000000-0000-4000-8000-000000000001",
      deviceId: "00000000-0000-4000-8000-000000000001",
      badgeId: "00000000-0000-4000-8000-000000000001",
      occurrenceId: null,
      action: "exception",
      exceptionReason: "organizer_approval",
      observedAt: "2026-10-04T10:00:00.000Z",
    });
    const result = eventScanResponseSchema.parse({
      operationId: "00000000-0000-4000-8000-000000000001",
      outcome: "denied",
      reason: "wrong_location",
      recorded: true,
      attendanceRecorded: false,
    });
    const html = render(
      <FastScannerView
        {...props}
        mode={mode}
        result={result}
        exceptionRequest={request}
        onExceptionConfirm={async () => {}}
      />,
    );
    expect(html).not.toContain("Review admission exception");
    expect(
      render(
        <FastScannerView
          {...props}
          mode="admission"
          result={result}
          exceptionRequest={request}
          onExceptionConfirm={async () => {}}
        />,
      ),
    ).toContain("Review admission exception");
  });
  it("distinguishes durable local checkout from a server checkout receipt without claiming admission", () => {
    const local = eventScanResponseSchema.parse({
      operationId: "00000000-0000-4000-8000-000000000001",
      outcome: "eligible",
      reason: "eligible",
      recorded: false,
      attendanceRecorded: false,
    });
    const localHtml = render(<FastScannerView {...props} mode="checkout" result={local} />);
    expect(localHtml).toContain("Checkout saved on device");
    expect(localHtml).not.toContain("Admission authorized");
    const receiptHtml = render(
      <FastScannerView {...props} mode="checkout" result={{ ...local, recorded: true, checkoutRecorded: true }} />,
    );
    expect(receiptHtml).toContain("Checkout recorded");
    expect(receiptHtml).not.toContain("Attendance recorded");
  });
  it("shows screen-awake status only after a granted wake lock and releases it on exit", async () => {
    const lock = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
    const request = vi.fn(async () => lock);
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const awake = vi.fn();
    const release = scannerImmersiveLifecycle(document.createElement("div"), () => {}, awake);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("screen");
    expect(awake).toHaveBeenLastCalledWith(true);
    release();
    expect(awake).toHaveBeenLastCalledWith(false);
    expect(lock.release).toHaveBeenCalledOnce();
    expect(render(<FastScannerView {...props} result={null} screenAwake />)).toContain("Screen awake");
  });
  it("does not promise to keep the screen awake when the browser denies the request", async () => {
    vi.stubGlobal("navigator", {
      wakeLock: {
        request: async () => {
          throw new Error("Denied");
        },
      },
    });
    const awake = vi.fn();
    const release = scannerImmersiveLifecycle(document.createElement("div"), () => {}, awake);
    await Promise.resolve();
    expect(awake).not.toHaveBeenCalledWith(true);
    release();
    expect(render(<FastScannerView {...props} result={null} />)).toContain("Screen may turn off");
  });
  it("releases the wake lock immediately when the scanner becomes hidden", async () => {
    const lock = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
    vi.stubGlobal("navigator", { wakeLock: { request: async () => lock } });
    const exit = vi.fn();
    const release = scannerImmersiveLifecycle(document.createElement("div"), exit);
    await Promise.resolve();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(exit).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
    release();
  });
  it("uses shared SVG status icons and exposes a next-badge countdown with a skip control", () => {
    const html = render(
      <FastScannerView
        {...props}
        result={null}
        cooldown={{ durationMs: 600, remainingMs: 400, saving: false, skip: () => {} }}
      />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("PKI Consortium");
    expect(html).toContain("Next badge in 0.4 seconds");
    expect(html).toContain("Scan next now");
    expect(html).toContain("<progress");
    expect(html).not.toContain("○");
  });
  it("never claims uploads are complete while scans remain pending", () => {
    const html = render(
      <FastScannerView {...props} pending={3} result={null} uploadStatus="All pending scans uploaded." />,
    );
    expect(html).not.toContain("All pending scans uploaded.");
    expect(html).toContain("Uploading scans in the background");
  });
  it("keeps an unacknowledged scan neutral and hides setup and personal data", () => {
    const html = render(<FastScannerView {...props} pending={3} result={null} />);
    expect(html).toContain("Verification pending");
    expect(html).toContain("3 pending");
    expect(html).toContain("pk-fast-scanner--unverified");
    expect(html).not.toContain("pk-fast-scanner--eligible");
    expect(html).not.toContain("pk-fast-scanner--result");
    expect(html).not.toContain("Badge code");
    expect(html).not.toContain("Scan mode");
  });
  it.each([
    ["eligible", "Registered"],
    ["denied", "Badge not valid"],
    ["unknown", "Unknown badge"],
    ["warning", "Known badge · not registered"],
    ["unverified", "Verification pending"],
  ] as const)("renders %s as a distinct result", (outcome, label) => {
    const result = eventScanResponseSchema.parse({
      operationId: "00000000-0000-4000-8000-000000000001",
      outcome,
      reason:
        outcome === "eligible" ? "eligible" : outcome === "warning" ? "missing_registration" : "unknown_credential",
      recorded: true,
      attendanceRecorded: false,
    });
    const html = render(<FastScannerView {...props} result={result} />);
    expect(html).toContain(label);
    expect(html).toContain(`pk-fast-scanner--${outcome}`);
    expect(html).toContain("pk-fast-scanner--result");
  });
  it("works without native fullscreen and releases the immersive lifecycle on exit", () => {
    const element = document.createElement("div");
    const exit = vi.fn();
    enterScannerFullscreen(element);
    const release = scannerImmersiveLifecycle(element, exit);
    expect(document.body.classList.contains("pk-scanner-immersive")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(exit).toHaveBeenCalledOnce();
    release();
    expect(document.body.classList.contains("pk-scanner-immersive")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(exit).toHaveBeenCalledOnce();
  });
});
