import { badgeCode, mocks, host, mount, submit } from "./event-scanner-fixture";
import { render } from "preact";
import { act } from "preact/test-utils";
import { useEffect } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { EventScanner } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner";
import { ScannerTaskNavigation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerTaskNavigation";
import { useBadgeCollectionPrinting } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useBadgeCollectionPrinting";
import type { ScannerStatus } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerStatus";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
const printing = vi.hoisted(() => ({ requested: vi.fn() }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/BadgeCollectionPrinter", () => ({
  BadgeCollectionPrinter: ({
    credential,
    onStatus,
    onBusy,
  }: {
    credential: string;
    onStatus: (status: ScannerStatus) => void;
    onBusy: (busy: boolean) => void;
  }) => {
    useEffect(() => {
      printing.requested(credential);
      onBusy(true);
      onStatus({ key: `print:${credential}`, tone: "unverified", title: "Print requested", record: false });
    }, [credential, onBusy, onStatus]);
    return null;
  },
}));
import {
  eventScanCaptureIntentSchema,
  eventScanRequestSchema,
  eventScanResponseSchema,
  type EventScanRequest,
} from "../../assets/shared/schemas/event-participation-scanning";
describe("scanner foreground receipt and drain lifecycle", () => {
  it.each(["collection", "entry"] as const)(
    "shows one persistent canceled-registration result in %s scanning",
    async (mode) => {
      const previousHash = window.location.hash;
      try {
        window.location.hash =
          mode === "collection"
            ? "#/events/synthetic-event/scanner?scannerPurpose=collection"
            : "#/events/synthetic-event/scanner";
        portalSession.value = portalSessionFixture({ member: true });
        await mount(true, ["attendance"], undefined, mode === "collection" ? "#/scanner/print" : undefined);
        let captured: EventScanRequest | undefined;
        mocks.persist.mockImplementation(async (intent) => {
          captured = eventScanRequestSchema.parse({
            ...intent,
            scannerSession: { epochId: "99999999-9999-4999-8999-999999999999", sequence: 1 },
          });
          return {
            scan: captured,
            local: { outcome: "warning", reason: "missing_registration", message: "Known badge is not registered" },
          };
        });
        mocks.drain.mockImplementation(async (send) => {
          if (!captured || !send) return { uploaded: 0, state: "complete" };
          const response = await send({ kind: "scan", eventId: "synthetic-event", scan: captured });
          return { uploaded: response.ok ? 1 : 0, state: response.ok ? "complete" : "retry" };
        });
        vi.stubGlobal(
          "fetch",
          vi.fn(async () =>
            Response.json({
              operationId: captured!.operationId,
              outcome: "warning",
              reason: "canceled_registration",
              recorded: true,
              attendanceRecorded: true,
              scannerReceipt: {
                ...captured!.scannerSession!,
                operationId: captured!.operationId,
                receivedAt: "2026-11-20T12:00:00.000Z",
              },
            }),
          ),
        );
        await act(() =>
          Array.from(host.querySelectorAll("button"))
            .find((button) => button.textContent?.trim() === "Start scanning")!
            .click(),
        );
        await act(() => mocks.hardwareScan!(badgeCode));
        await vi.waitFor(() =>
          expect(host.querySelector(".pk-fast-scanner__label")?.textContent).toBe("Registration canceled"),
        );
        await new Promise((resolve) => setTimeout(resolve, 1200));
        expect(host.querySelector(".pk-fast-scanner__label")?.textContent).toBe("Registration canceled");
        expect(host.textContent).not.toContain("Ask the attendee");
        expect(host.textContent).not.toContain("Known badge is not registered");
        expect(host.textContent).not.toContain("Print this badge");
        expect(host.querySelector('[aria-label="Attendee name"]')).toBeNull();
        const nextLabel = mode === "collection" ? "Next attendee" : "Next badge";
        await act(() => mocks.hardwareScan!("ZYXWVUTSRQPNMLKJ"));
        expect(mocks.persist).toHaveBeenCalledOnce();
        expect(host.querySelector(`button[aria-label="${nextLabel}"]`)?.textContent).toBe("Next");
        await act(() =>
          Array.from(host.querySelectorAll("button"))
            .find((button) => button.getAttribute("aria-label") === nextLabel)!
            .click(),
        );
        expect(host.querySelector(".pk-fast-scanner__label")?.textContent).toBe(
          mode === "collection" ? "Ready for badge collection" : "Ready for entry",
        );
      } finally {
        window.location.hash = previousHash;
      }
    },
  );
  it.each(["manual", "hardware"] as const)("retries an unsaved collection scan through %s input", async (input) => {
    const previousHash = window.location.hash;
    try {
      window.location.hash = "#/events/synthetic-event/scanner?scannerPurpose=collection";
      await mount(true, ["attendance"]);
      mocks.persist.mockRejectedValueOnce(new Error("Storage temporarily unavailable"));
      mocks.persist.mockImplementation(async (scan) => ({
        scan: eventScanCaptureIntentSchema.parse(scan),
        local: { outcome: "eligible", reason: "eligible", message: "Saved on this device" },
      }));
      if (input === "manual") {
        await submit();
        expect(host.querySelector<HTMLInputElement>('input[name="badgeId"]')?.value).toBe(badgeCode);
        expect(host.textContent).toContain("retry the scan");
        await submit();
      } else {
        const start = Array.from(host.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "Start scanning",
        )!;
        await act(async () => start.click());
        await act(async () => mocks.hardwareScan!(badgeCode));
        await vi.waitFor(() => expect(host.textContent).toContain("retry the scan"));
        await act(() =>
          Array.from(host.querySelectorAll("button"))
            .find((button) => button.getAttribute("aria-label") === "Next badge")!
            .click(),
        );
        await act(async () => mocks.hardwareScan!(badgeCode));
      }
      await vi.waitFor(() => expect(mocks.persist).toHaveBeenCalledTimes(2));
      expect(
        Array.from(host.querySelectorAll("button")).some(
          (button) => button.getAttribute("aria-label") === "Next attendee",
        ),
      ).toBe(true);
    } finally {
      window.location.hash = previousHash;
    }
  });
  it("prints the held badge without replacing the collection scanner", async () => {
    const previousHash = window.location.hash;
    try {
      window.location.hash = "#/events/synthetic-event/scanner?scannerPurpose=collection";
      portalSession.value = portalSessionFixture({ member: true });
      await mount(true, ["attendance", "checkout"]);
      mocks.persist.mockImplementation(async (scan) => ({
        scan: eventScanCaptureIntentSchema.parse(scan),
        local: { outcome: "eligible", reason: "eligible", message: "Registered" },
      }));
      const onLaunch = vi.fn();
      await act(() =>
        render(
          <ScannerTaskNavigation.Provider
            value={{
              launch: null,
              onLaunch,
              onConsumed: vi.fn(),
              tasks: [
                { key: "entry", label: "Entry", href: "#/scanner" },
                { key: "exit", label: "Exit", href: "#/scanner?scanAction=checkout" },
                { key: "print", label: "Print", href: "#/scanner/print" },
              ],
            }}
          >
            <EventScanner
              slug="synthetic-event"
              operatorUserId="11111111-1111-4111-8111-111111111111"
              allowedActions={["attendance", "checkout"]}
              printHref="#/scanner/print"
            />
          </ScannerTaskNavigation.Provider>,
          host,
        ),
      );
      const start = () =>
        Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Start scanning")!;
      await vi.waitFor(() => expect(start().disabled).toBe(false));
      await act(async () => {
        start().click();
      });
      expect(host.querySelector(".pk-fast-scanner")).not.toBeNull();
      await act(async () => {
        mocks.hardwareScan!(badgeCode);
      });
      await vi.waitFor(() => {
        const print = Array.from(host.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "Print this badge",
        );
        expect(print, host.textContent ?? "").toBeDefined();
        expect(print!.disabled).toBe(false);
      });
      const exit = host.querySelector<HTMLButtonElement>('[aria-label="Switch to Exit"]')!;
      await vi.waitFor(() => expect(exit.disabled).toBe(false));
      await act(() => exit.click());
      expect(onLaunch).toHaveBeenCalledWith("exit", "entry");
      await act(() =>
        Array.from(host.querySelectorAll("button"))
          .find((button) => button.textContent?.trim() === "Print this badge")!
          .click(),
      );
      expect(printing.requested).toHaveBeenCalledWith(badgeCode);
      expect(host.textContent).toContain("Print requested");
      expect(window.location.hash).toBe("#/events/synthetic-event/scanner?scannerPurpose=collection");
      expect(host.querySelector(".pk-fast-scanner")).not.toBeNull();
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      try {
        await act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(
          Array.from(host.querySelectorAll("button")).some(
            (button) => button.textContent?.trim() === "Print this badge",
          ),
        ).toBe(true);
        expect(host.querySelector(".pk-fast-scanner")).not.toBeNull();
      } finally {
        visibility.mockRestore();
      }
      await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close scanner"]')!.click());
      await act(() => start().click());
      expect(host.textContent).not.toContain("Print requested");
    } finally {
      window.location.hash = previousHash;
    }
  });
  it("releases the collection print hold when the portal session changes", async () => {
    function PrintProbe() {
      const job = useBadgeCollectionPrinting("synthetic-event", true, true);
      return (
        <div>
          <button onClick={() => job.print(badgeCode)}>Print</button>
          <span>{job.busy ? "busy" : "idle"}</span>
          <span>{job.status?.title ?? "No print status"}</span>
          {job.job}
        </div>
      );
    }
    portalSession.value = portalSessionFixture({ member: true });
    await act(() => render(<PrintProbe />, host));
    await act(() => host.querySelector("button")!.click());
    expect(host.textContent).toContain("busy");
    expect(host.textContent).toContain("Print requested");
    await act(() => {
      portalSession.value = portalSessionFixture({ member: true });
      render(<PrintProbe />, host);
    });
    expect(host.textContent).toContain("idle");
    expect(host.textContent).toContain("No print status");
  });
  it("retains the last result after scanning resumes and updates it from a late server receipt", async () => {
    const worker = new EventTarget();
    vi.stubGlobal("navigator", { serviceWorker: worker, onLine: false });
    await mount(true, ["attendance"]);
    mocks.persist.mockImplementation(async (scan) => ({
      scan: eventScanCaptureIntentSchema.parse(scan),
      local: { outcome: "eligible", reason: "eligible", message: "Saved on this device" },
    }));
    await submit();
    const scan = eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0]![0]);
    await vi.waitFor(() => expect(host.querySelector(".pk-fast-scanner__label")?.textContent).toBe("Ready for entry"), {
      timeout: 1500,
    });
    expect(host.querySelector(".pk-fast-scanner__trail")?.textContent).toContain("scan saved on device");
    const receipt = eventScanResponseSchema.parse({
      operationId: scan.operationId,
      outcome: "denied",
      reason: "revoked_badge",
      recorded: true,
      attendanceRecorded: false,
    });
    await act(() => {
      worker.dispatchEvent(new MessageEvent("message", { data: receipt }));
    });
    expect(host.querySelector(".pk-fast-scanner__trail")?.textContent).toContain("Badge not valid");
    expect(host.querySelector(".pk-fast-scanner__label")?.textContent).toBe("Badge not valid");
    expect(host.querySelector('button[aria-label="Next badge"]')?.textContent).toBe("Next");
    await act(() =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.getAttribute("aria-label") === "Next badge")!
        .click(),
    );
    await act(() => {
      worker.dispatchEvent(new MessageEvent("message", { data: receipt }));
    });
    expect(host.querySelector(".pk-fast-scanner__label")?.textContent).not.toBe("Badge not valid");
  });
  it.each([false, true])(
    "replaces provisional helper text with a matching foreground receipt (continuous=%s)",
    async (continuous) => {
      await mount(true, ["attendance"]);
      let upload: (() => Promise<Response>) | undefined;
      let captured: EventScanRequest | undefined;
      mocks.persist.mockImplementation(async (scan) => {
        captured = eventScanRequestSchema.parse({
          ...scan,
          scannerSession: { epochId: "99999999-9999-4999-8999-999999999999", sequence: 1 },
        });
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
        if (captured && send) upload = () => send({ kind: "scan", eventId: "synthetic-event", scan: captured! });
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
              scannerReceipt: {
                ...request.scannerSession!,
                operationId: request.operationId,
                receivedAt: "2026-11-06T12:00:00.000Z",
              },
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
          mocks.hardwareScan!(badgeCode);
        });
      } else await submit();
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(upload).toBeDefined();
      });
      const feedback = host.querySelector(".pk-fast-scanner")!;
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
    expect(host.querySelector(".pk-event-scanner")?.textContent).toContain(
      "Scan was not saved. The failure audit is saved for upload; retry the scan.",
    );
  });

  it("retries the existing foreground drain on focus and removes its listener on unmount", async () => {
    await mount(true);
    await vi.waitFor(() => expect(mocks.drain).toHaveBeenCalledOnce());
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
});
