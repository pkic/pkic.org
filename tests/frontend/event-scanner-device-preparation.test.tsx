vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  scannerUploadSuspended: vi.fn(async () => false),
  subscribeUserSessionState: () => () => {},
}));
import { formatDateTime } from "../../assets/shared/format-date";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventScanCaptureIntentSchema,
  eventScanRequestSchema,
  eventScanResponseSchema,
  type EventScanRequest,
} from "../../assets/shared/schemas/event-participation-scanning";
const mocks = vi.hoisted(() => ({
  ready: false,
  state: "open",
  persist: vi.fn(),
  freeze: vi.fn(),
  close: vi.fn(),
  next: vi.fn(),
  drain: vi.fn(async (_send?: (record: { eventId: string; scan: EventScanRequest }) => Promise<Response>) => ({
    uploaded: 0,
    state: "complete",
  })),
  hardwareScan: null as null | ((credential: string) => void),
  snapshot: null as null | { serverNow: string; expiresAt: string; validUntil: number },
}));
// Receipt presentation uses synthetic hardware input; camera decoding has its own lifecycle and browser tests.
vi.mock("qr-scanner", () => ({
  default: class {
    async start() {}
    destroy() {}
  },
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerDevice", () => ({
  useScannerDevice: () => ({
    deviceId: "22222222-2222-4222-8222-222222222222",
    ready: mocks.ready,
    error: "",
    epoch: mocks.state === "preparing" ? null : { state: mocks.state },
    setEpoch: vi.fn((epoch) => {
      mocks.state = epoch.state;
      mocks.ready = epoch.state === "open";
    }),
  }),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerDecoderPreparation", () => ({
  useScannerDecoderPreparation: () => "Camera prepared",
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest", () => ({
  useEligibilityManifest: () => ({
    eligibilityManifest: { current: mocks.snapshot },
    manifestReady: true,
    manifestPreparing: false,
    manifestError: "",
  }),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox", () => ({
  drainScanOutbox: mocks.drain,
  pendingScanCount: vi.fn(async () => 0),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerHardware", () => ({
  useScannerHardware: (_active: boolean, onScan: (credential: string) => void) => {
    mocks.hardwareScan = onScan;
  },
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/useOfflineAdmission", () => ({
  useOfflineAdmission: () => ({ grantId: null, select: vi.fn(), persist: mocks.persist }),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerRecovery", () => ({
  ScannerRecovery: () => null,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerSetup", () => ({
  ScannerSetup: () => null,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-device-ledger", () => ({
  freezeScannerEpoch: mocks.freeze,
  closeScannerEpoch: mocks.close,
  startNextScannerEpoch: mocks.next,
}));
import { EventScanner } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner";
let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  mocks.snapshot = null;
  mocks.drain.mockImplementation(async () => ({ uploaded: 0, state: "complete" }));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function mount(ready: boolean, actions: ("attendance" | "check" | "exception")[] = ["check"]) {
  mocks.ready = ready;
  mocks.state = ready ? "open" : "preparing";
  host = document.createElement("div");
  document.body.append(host);
  mocks.persist.mockImplementation(async (scan) => ({
    scan: eventScanCaptureIntentSchema.parse(scan),
    local: undefined,
  }));
  await act(async () => {
    render(
      <EventScanner
        slug="synthetic-event"
        operatorUserId="11111111-1111-4111-8111-111111111111"
        allowedActions={actions}
      />,
      host,
    );
  });
}
async function submit() {
  const input = host.querySelector<HTMLInputElement>('input[name="badgeId"]')!;
  await act(async () => {
    input.value = "33333333-3333-4333-8333-333333333333";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
describe("scanner preparation capture boundary", () => {
  it.each([false, true])(
    "replaces provisional helper text with a matching foreground receipt (continuous=%s)",
    async (continuous) => {
      await mount(true, ["attendance"]);
      let upload: (() => Promise<Response>) | undefined;
      let captured: EventScanRequest | undefined;
      mocks.persist.mockImplementation(async (scan) => {
        captured = eventScanRequestSchema.parse(scan);
        return {
          scan: captured,
          local: {
            outcome: "eligible",
            reason: "eligible",
            message: "Attendance saved on this device; upload pending.",
          },
        };
      });
      mocks.drain.mockImplementation(async (send) => {
        if (captured && send) upload = () => send({ eventId: "synthetic-event", scan: captured! });
        return { uploaded: 0, state: "retry" };
      });
      const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = eventScanRequestSchema.parse(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify(
            eventScanResponseSchema.parse({
              operationId: request.operationId,
              outcome: "unverified",
              reason: "verification_required",
              recorded: true,
              attendanceRecorded: false,
            }),
          ),
          { status: 200 },
        );
      });
      vi.stubGlobal("fetch", fetch);
      if (continuous) {
        await act(async () => {
          Array.from(host.querySelectorAll("button"))
            .find((button) => button.textContent?.trim() === "Start scanning")!
            .click();
        });
        await act(async () => {
          mocks.hardwareScan!("33333333-3333-4333-8333-333333333333");
        });
      } else await submit();
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(upload).toBeDefined();
      });
      const feedback = host.querySelector(continuous ? ".pk-fast-scanner" : ".pk-event-scanner")!;
      expect(feedback.textContent).toContain("upload pending");
      await act(async () => {
        await upload!();
      });
      expect(feedback.textContent).toContain("Verification pending");
      expect(feedback.textContent).not.toContain("upload pending");
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("ignores stale worker receipts and updates helper text only for the displayed operation", async () => {
    const worker = new EventTarget();
    vi.stubGlobal("navigator", { serviceWorker: worker, onLine: false });
    await mount(true, ["attendance"]);
    mocks.persist.mockImplementation(async (scan) => ({
      scan: eventScanCaptureIntentSchema.parse(scan),
      local: { outcome: "eligible", reason: "eligible", message: "Attendance saved on this device; upload pending." },
    }));
    await submit();
    const first = eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0][0]);
    await submit();
    const current = eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[1][0]);
    const receipt = (operationId: string) =>
      eventScanResponseSchema.parse({
        operationId,
        outcome: "denied",
        reason: "revoked_badge",
        recorded: true,
        attendanceRecorded: false,
      });
    await act(async () => {
      worker.dispatchEvent(new MessageEvent("message", { data: receipt(first.operationId) }));
    });
    expect(host.querySelector(".pk-event-scanner")?.textContent).toContain("upload pending");
    await act(async () => {
      worker.dispatchEvent(new MessageEvent("message", { data: receipt(current.operationId) }));
    });
    expect(host.querySelector(".pk-event-scanner")?.textContent).toContain("Badge not valid");
    expect(host.querySelector(".pk-event-scanner")?.textContent).not.toContain("upload pending");
  });

  it("keeps a committed worker receipt when delayed local eligibility finishes", async () => {
    const worker = new EventTarget();
    vi.stubGlobal("navigator", { serviceWorker: worker, onLine: false });
    await mount(true, ["attendance"]);
    mocks.persist.mockImplementation(async (scan) => {
      const captured = eventScanCaptureIntentSchema.parse(scan);
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: eventScanResponseSchema.parse({
            operationId: captured.operationId,
            outcome: "unverified",
            reason: "verification_required",
            recorded: true,
            attendanceRecorded: false,
          }),
        }),
      );
      return {
        scan: captured,
        local: { outcome: "eligible", reason: "eligible", message: "Attendance saved on this device; upload pending." },
      };
    });
    await submit();
    expect(host.querySelector(".pk-event-scanner")?.textContent).toContain("Verification pending");
    expect(host.querySelector(".pk-event-scanner")?.textContent).not.toContain("upload pending");
  });

  it("preserves an unrelated persistence-failure message when a matching worker receipt arrives", async () => {
    const worker = new EventTarget();
    vi.stubGlobal("navigator", { serviceWorker: worker, onLine: false });
    await mount(true, ["attendance"]);
    mocks.persist.mockRejectedValueOnce(new Error("Storage unavailable"));
    await submit();
    const captured = eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0][0]);
    await act(async () => {
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: eventScanResponseSchema.parse({
            operationId: captured.operationId,
            outcome: "unverified",
            reason: "verification_required",
            recorded: true,
            attendanceRecorded: false,
          }),
        }),
      );
    });
    expect(host.querySelector(".pk-event-scanner")?.textContent).toContain("Unable to save this scan");
  });

  it("keeps capture disabled until persistent device enrollment is ready", async () => {
    await mount(false);
    expect(host.textContent).toContain("Preparing scanner session");
    await submit();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(
      Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Start scanning")
        ?.disabled,
    ).toBe(true);
  });
  it("defaults to attendance and keeps recovery collapsed without quota or exception controls", async () => {
    await mount(true, ["check", "attendance", "exception"]);
    const modes = host.querySelector<HTMLSelectElement>('select[name="action"]')!;
    expect(modes.value).toBe("attendance");
    expect(Array.from(modes.options).map((option) => option.value)).toEqual(["check", "attendance"]);
    const recovery = host.querySelector<HTMLDetailsElement>("details.pk-panel")!;
    expect(recovery.open).toBe(false);
    expect(recovery.querySelector("summary")?.textContent).toBe("Recovery and diagnostics");
    expect(host.textContent).not.toMatch(/Allocate for one hour|Prepare offline admission|Review admission exception/);
    mocks.persist.mockImplementation(async (scan) => ({
      scan: eventScanCaptureIntentSchema.parse(scan),
      local: { outcome: "warning", reason: "missing_registration", message: "Known badge is not registered" },
    }));
    await submit();
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(mocks.persist.mock.calls[0][0].action).toBe("attendance");
    expect(host.querySelector(".pk-event-scanner--warning")?.textContent).toContain("Known badge · not registered");
    expect(host.textContent).not.toContain("Review admission exception");
  });
  it("validates the capture intent without guessing allocator sequence", async () => {
    await mount(true);
    await submit();
    expect(mocks.persist).toHaveBeenCalledOnce();
    const parsed = eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0]![0]);
    expect(parsed.badgeId).toBe("33333333-3333-4333-8333-333333333333");
    expect(parsed).not.toHaveProperty("scannerSession");
  });
  it("freezes a zero-scan session and retries explicit close without enabling more capture", async () => {
    await mount(true);
    const frozen = { state: "closing", epochId: "77777777-7777-4777-8777-777777777777", issuedHighWater: 0 };
    mocks.freeze.mockResolvedValue(frozen);
    mocks.close.mockRejectedValueOnce(new Error("Server scanner coverage is incomplete"));
    const close = () =>
      Array.from(host.querySelectorAll("button")).find((button) =>
        /Close scanner session|Retry closing scanner session/.test(button.textContent ?? ""),
      )!;
    await act(async () => {
      close().click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.freeze).toHaveBeenCalledWith(
      "synthetic-event",
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(host.textContent).toContain("Retry closing scanner session");
    await submit();
    expect(mocks.persist).not.toHaveBeenCalled();
    mocks.close.mockResolvedValueOnce({ ...frozen, state: "closed" });
    await act(async () => {
      close().click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.close).toHaveBeenLastCalledWith(frozen, undefined);
    expect(host.textContent).toContain("All captured operations are accounted for");
    expect(close().disabled).toBe(true);
    mocks.next.mockResolvedValueOnce({
      state: "open",
      issuedHighWater: 0,
      epochId: "88888888-8888-4888-8888-888888888888",
    });
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "Start next scanner session")!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.next).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("New scanner session prepared");
    await submit();
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
  it("retries the existing foreground drain on focus and removes its listener on unmount", async () => {
    await mount(true);
    const initial = mocks.drain.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.drain).toHaveBeenCalledTimes(initial + 1);
    await act(async () => {
      render(null, host);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.drain).toHaveBeenCalledTimes(initial + 1);
  });
  it("shows qualified expired-snapshot feedback in manual and continuous scanning while preserving capture", async () => {
    await mount(true, ["attendance"]);
    const message =
      "Known badge in an expired snapshot. Current registration and later revocations require online verification.";
    mocks.persist.mockImplementation(async (scan) => ({
      scan: eventScanCaptureIntentSchema.parse(scan),
      local: {
        outcome: "unverified",
        reason: "verification_required",
        userId: "55555555-5555-4555-8555-555555555555",
        message,
      },
    }));
    await submit();
    expect(host.querySelector(".pk-event-scanner--unverified")?.textContent).toContain(message);
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Start scanning")!
        .click();
    });
    await act(async () => {
      mocks.hardwareScan!("33333333-3333-4333-8333-333333333333");
    });
    const fast = host.querySelector('[role="dialog"][aria-label="Continuous badge scanner"]')!;
    // Hardware callbacks return immediately; wait for persistence and the pending-count read to settle.
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(fast.textContent).toContain(message);
    });
    expect(fast.className).toContain("pk-fast-scanner--unverified");
    expect(fast.textContent).toContain(message);
    expect(fast.textContent).not.toContain("Registered ·");
    expect(mocks.persist).toHaveBeenCalledTimes(2);
  });
  it("passes the same server snapshot timestamps to normal status and continuous operator controls", async () => {
    mocks.snapshot = {
      serverNow: "2026-12-01T09:00:00.000Z",
      expiresAt: "2026-12-01T09:15:00.000Z",
      validUntil: Date.now() - 1,
    };
    await mount(true, ["attendance"]);
    const normal = Array.from(host.querySelectorAll("dl")).find((list) =>
      list.textContent?.includes("Last eligibility check"),
    )!;
    expect(normal.textContent).toContain("Last eligibility check");
    expect(normal.textContent).toContain(formatDateTime(mocks.snapshot.serverNow));
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Start scanning")!
        .click();
    });
    const fast = host.querySelector('[role="dialog"][aria-label="Continuous badge scanner"]')!;
    expect(fast.textContent).toContain("Last eligibility check");
    expect(fast.textContent).toContain(formatDateTime(mocks.snapshot.serverNow));
    expect(fast.textContent).toContain(formatDateTime(mocks.snapshot.expiresAt));
    expect(fast.textContent).toContain("Using saved registration data");
  });
  it.each(["eligible", "unknown"] as const)(
    "resets the cleared entry field after a successfully captured %s badge without changing its result",
    async (outcome) => {
      await mount(true, ["attendance"]);
      mocks.persist.mockImplementation(async (scan) => ({
        scan: eventScanCaptureIntentSchema.parse(scan),
        local: {
          outcome,
          reason: outcome === "unknown" ? "unknown_credential" : "eligible",
          message: "Captured observation",
        },
      }));
      await submit();
      const input = host.querySelector<HTMLInputElement>('input[name="badgeId"]')!;
      expect(input.value).toBe("");
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      expect(input.closest(".pk-field")?.className).not.toContain("pk-field--invalid");
      expect(host.querySelector(`.pk-event-scanner--${outcome}`)?.textContent).toContain("Captured observation");
      expect(mocks.persist).toHaveBeenCalledOnce();
      expect(eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0][0]).badgeId).toBe(
        "33333333-3333-4333-8333-333333333333",
      );
      // A new empty submission still receives the canonical error; only completed capture resets presentation.
      await act(async () => {
        host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(mocks.persist).toHaveBeenCalledOnce();
    },
  );
  it("preserves the entered badge for retry when local capture fails", async () => {
    await mount(true, ["attendance"]);
    mocks.persist.mockRejectedValueOnce(new Error("Storage unavailable"));
    await submit();
    expect(host.querySelector<HTMLInputElement>('input[name="badgeId"]')!.value).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(host.textContent).toContain("Unable to save this scan");
  });
  it("resets previous manual validation after successful continuous hardware capture", async () => {
    await mount(true, ["attendance"]);
    const input = host.querySelector<HTMLInputElement>('input[name="badgeId"]')!;
    await act(async () => {
      input.value = "invalid badge";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    mocks.persist.mockImplementation(async (scan) => ({
      scan: eventScanCaptureIntentSchema.parse(scan),
      local: { outcome: "unknown", reason: "unknown_credential", message: "Unknown badge for this event snapshot." },
    }));
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Start scanning")!
        .click();
    });
    await act(async () => {
      mocks.hardwareScan!("33333333-3333-4333-8333-333333333333");
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(input.value).toBe("");
    });
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.closest(".pk-field")?.className).not.toContain("pk-field--invalid");
    expect(host.querySelector(".pk-fast-scanner--unknown")?.textContent).toContain(
      "Unknown badge for this event snapshot",
    );
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
});
