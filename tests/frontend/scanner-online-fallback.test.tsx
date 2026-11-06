import { badgeCode, mocks, host, mount, submit } from "./event-scanner-fixture";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { pendingScanCount } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox";
import {
  eventScanRequestSchema,
  eventScanResponseSchema,
  type EventScanRequest,
} from "../../assets/shared/schemas/event-participation-scanning";

function captureMissingBadge() {
  let captured: EventScanRequest | undefined;
  mocks.persist.mockImplementation(async (scan) => {
    captured = eventScanRequestSchema.parse({
      ...scan,
      scannerSession: { epochId: "99999999-9999-4999-8999-999999999999", sequence: 1 },
    });
    return {
      scan: captured,
      local: { outcome: "unknown", reason: "unknown_credential", message: "Unknown saved badge" },
    };
  });
  mocks.drain.mockImplementation(async (send) => {
    if (!captured || !send) return { uploaded: 0, state: "complete" };
    const response = await send({ kind: "scan", eventId: "synthetic-event", scan: captured });
    return { uploaded: response.ok ? 1 : 0, state: response.ok ? "complete" : "retry" };
  });
  return () => captured;
}
async function scan(continuous: boolean) {
  if (!continuous) return submit({ waitForIdle: false });
  await act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Start scanning")!
      .click();
  });
  await act(async () => {
    mocks.hardwareScan!(badgeCode);
  });
}

describe("Online verification after a local badge miss", () => {
  it("still verifies a saved scan when the pending count fails", async () => {
    await mount(true, ["attendance"]);
    captureMissingBadge();
    vi.mocked(pendingScanCount).mockRejectedValueOnce(new Error("Count failed"));
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = eventScanRequestSchema.parse(JSON.parse(String(init?.body)));
      return Response.json({
        operationId: request.operationId,
        outcome: "eligible",
        reason: "eligible",
        recorded: true,
        attendanceRecorded: true,
        scannerReceipt: {
          ...request.scannerSession!,
          operationId: request.operationId,
          receivedAt: "2026-11-06T12:00:00.000Z",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await scan(true);
    await vi.waitFor(() => expect(host.textContent).toContain("attendance recorded"));
    expect(host.textContent).not.toContain("Scan not recorded");
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("releases capture promptly while a slow online check continues", async () => {
    await mount(true, ["attendance"]);
    captureMissingBadge();
    let release: (() => void) | undefined;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = eventScanRequestSchema.parse(JSON.parse(String(init?.body)));
      return new Promise<Response>((resolve) => {
        release = () =>
          resolve(
            Response.json({
              operationId: request.operationId,
              outcome: "eligible",
              reason: "eligible",
              recorded: true,
              attendanceRecorded: true,
              scannerReceipt: {
                ...request.scannerSession!,
                operationId: request.operationId,
                receivedAt: "2026-11-06T12:00:00.000Z",
              },
            }),
          );
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await scan(true);
    await vi.waitFor(() => expect(release).toBeDefined());
    await vi.waitFor(() => expect(host.textContent).toContain("Verification pending"), { timeout: 3000 });
    expect(host.textContent).not.toContain("Checking badge online");
    expect(host.textContent).not.toContain("Unknown badge");
    await act(async () => {
      release!();
    });
    await vi.waitFor(() => expect(host.textContent).toContain("attendance recorded"));
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("waits for the server before reporting a result (continuous=%s)", async (continuous) => {
    await mount(true, ["attendance"]);
    const captured = captureMissingBadge();
    let release: (() => void) | undefined;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = eventScanRequestSchema.parse(JSON.parse(String(init?.body)));
      expect(request).toEqual(captured());
      return new Promise<Response>((resolve) => {
        release = () =>
          resolve(
            Response.json(
              eventScanResponseSchema.parse({
                operationId: request.operationId,
                outcome: "eligible",
                reason: "eligible",
                recorded: true,
                attendanceRecorded: true,
                scannerReceipt: {
                  ...request.scannerSession!,
                  operationId: request.operationId,
                  receivedAt: "2026-11-06T12:00:00.000Z",
                },
              }),
            ),
          );
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await scan(continuous);
    await vi.waitFor(() => expect(release).toBeDefined());
    await vi.waitFor(() => expect(host.textContent).toContain("Checking badge online"));
    expect(host.textContent).not.toContain("Unknown badge");
    expect(host.querySelector(".pk-event-scanner--unknown")).toBeNull();
    await act(async () => {
      release!();
    });
    await vi.waitFor(() => expect(host.textContent).toContain("attendance recorded"));
    expect(host.textContent).not.toContain("Unknown badge");
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown badge only after the server confirms the miss", async () => {
    await mount(true, ["attendance"]);
    captureMissingBadge();
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = eventScanRequestSchema.parse(JSON.parse(String(init?.body)));
        return new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              Response.json(
                eventScanResponseSchema.parse({
                  operationId: request.operationId,
                  outcome: "unknown",
                  reason: "unknown_credential",
                  recorded: true,
                  attendanceRecorded: false,
                  scannerReceipt: {
                    ...request.scannerSession!,
                    operationId: request.operationId,
                    receivedAt: "2026-11-06T12:00:00.000Z",
                  },
                }),
              ),
            );
        });
      }),
    );
    await scan(true);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(host.textContent).not.toContain("Unknown badge");
    await act(async () => {
      release!();
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Unknown badge"));
    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });

  it("keeps the miss unverified when the online attempt fails", async () => {
    vi.stubGlobal("navigator", { onLine: false, serviceWorker: new EventTarget() });
    await mount(true, ["attendance"]);
    captureMissingBadge();
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      eventScanRequestSchema.parse(JSON.parse(String(init?.body)));
      throw new TypeError("Disconnected");
    });
    vi.stubGlobal("fetch", fetcher);
    await scan(true);
    await vi.waitFor(() => expect(host.textContent).toContain("Verification pending"));
    expect(host.textContent).not.toContain("Unknown badge");
    expect(host.querySelector(".pk-event-scanner--unknown")).toBeNull();
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
