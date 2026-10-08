import { badgeCode, mocks, host, mount, submit } from "./event-scanner-fixture";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import {
  eventScanCaptureIntentSchema,
  eventScanRequestSchema,
  eventScanResponseSchema,
  type EventScanRequest,
} from "../../assets/shared/schemas/event-participation-scanning";
describe("scanner foreground receipt and drain lifecycle", () => {
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
          mocks.hardwareScan!(badgeCode);
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
