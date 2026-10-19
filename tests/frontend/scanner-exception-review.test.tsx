import { render } from "preact";
import { act } from "preact/test-utils";
import { FastScannerView } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/FastScannerView";
import {
  eventScanRequestSchema,
  type EventScanRequest,
} from "../../assets/shared/schemas/event-participation-scanning";
import { describe, expect, it, vi } from "vitest";
import {
  ScannerExceptionReview,
  scannerExceptionRequest,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerExceptionReview";
const operatorUserId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  targetId = "33333333-3333-4333-8333-333333333333",
  roomId = "44444444-4444-4444-8444-444444444444",
  badge = "ABCDEFGHJKLMNPQR";
describe("Fullscreen exception review", () => {
  it.each([false, true])(
    "preserves the exception scope and makes attendance explicit (%s)",
    async (recordAttendance) => {
      const first = scannerExceptionRequest({ operatorUserId, deviceId, targetId, roomId }, badge)!;
      const second = scannerExceptionRequest({ operatorUserId, deviceId, targetId, roomId }, badge)!;
      expect(first.operationId).not.toBe(second.operationId);
      const host = document.createElement("div"),
        confirm = vi.fn(async (request: EventScanRequest) => {
          eventScanRequestSchema.parse(request);
        }),
        cancel = vi.fn();
      document.body.append(host);
      try {
        await act(async () =>
          render(<ScannerExceptionReview request={first} onConfirm={confirm} onCancel={cancel} />, host),
        );
        expect(host.textContent).not.toContain(badge);
        expect(host.textContent).toContain("Attendance is recorded only");
        expect(host.textContent).toContain("submit an admission exception for a server decision");
        if (recordAttendance)
          await act(() => {
            host.querySelector<HTMLInputElement>('[name="recordAttendance"]')!.click();
          });
        await act(async () => {
          host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        expect(confirm).toHaveBeenCalledWith(
          expect.objectContaining({
            operatorUserId,
            deviceId,
            occurrenceId: targetId,
            roomId,
            badgeId: badge,
            action: "exception",
            exceptionReason: "organizer_approval",
            recordAttendance,
          }),
        );
        expect(cancel).toHaveBeenCalledOnce();
      } finally {
        render(null, host);
        host.remove();
      }
    },
  );
  it("refuses an invalid QR rather than opening an exception for an unknown identifier", () => {
    expect(scannerExceptionRequest({ operatorUserId, deviceId, targetId, roomId }, "invalid")).toBeNull();
  });
  it("pauses badge intake for permitted drawer review and resumes without exiting fast mode", async () => {
    const request = scannerExceptionRequest({ operatorUserId, deviceId, targetId, roomId }, badge)!;
    const host = document.createElement("div"),
      pause = vi.fn(),
      confirm = vi.fn(async () => {}),
      exit = vi.fn();
    document.body.append(host);
    const props = {
      context: "Session",
      pending: 0,
      message: "Registration required",
      cameraActive: true,
      preview: false,
      onPreview: () => {},
      onExit: exit,
      result: {
        operationId: request.operationId,
        outcome: "warning" as const,
        reason: "missing_registration" as const,
        attendanceRecorded: false,
        recorded: true,
      },
      onOperatorPause: pause,
      onExceptionConfirm: confirm,
    };
    try {
      await act(async () => render(<FastScannerView {...props} />, host));
      expect(host.textContent).not.toContain("Review admission exception");
      await act(async () => render(<FastScannerView {...props} exceptionRequest={request} />, host));
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Operator controls"]')!.click());
      expect(pause).toHaveBeenLastCalledWith(true);
      await act(async () =>
        [...host.querySelectorAll<HTMLButtonElement>("button")]
          .find((b) => b.textContent === "Review admission exception")!
          .click(),
      );
      await act(async () => {
        host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(confirm).toHaveBeenCalledOnce();
      expect(exit).not.toHaveBeenCalled();
      expect(pause).toHaveBeenLastCalledWith(false);
    } finally {
      render(null, host);
      host.remove();
    }
  });
});
