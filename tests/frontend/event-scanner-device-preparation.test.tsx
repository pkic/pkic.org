import {
  badgeCode,
  mocks,
  host,
  mount,
  openManual,
  scannerDialog,
  openDiagnostics,
  closeDiagnostics,
  submit,
} from "./event-scanner-fixture";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { eventScanCaptureIntentSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { formatDateTime } from "../../assets/shared/format-date";
describe("scanner device enrollment and manual capture boundary", () => {
  it("keeps capture disabled until persistent device enrollment is ready", async () => {
    await mount(false);
    expect(host.textContent).toContain("Preparing scanner for this session");
    await submit();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(
      Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Start scanning")
        ?.disabled,
    ).toBe(true);
  });
  it("defaults to attendance with explicit manual entry and recovery in its dedicated dialog without quota or exception controls", async () => {
    await mount(true, ["check", "attendance", "exception"]);
    const modes = host.querySelector<HTMLSelectElement>('select[name="action"]')!;
    expect(modes.value).toBe("attendance");
    expect(Array.from(modes.options).map((option) => option.value)).toEqual(["check", "attendance"]);
    const recovery = scannerDialog("Recovery and diagnostics");
    expect(recovery.open).toBe(false);
    expect(host.querySelector("details, summary")).toBeNull();
    expect(host.querySelector('input[name="badgeId"]')).toBeNull();
    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual([
      "Scan",
      "Recent scans",
    ]);
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Recovery and diagnostics",
      ),
    ).toBe(true);
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
  it("switches continuous scanning to Recent scans, stops the camera and retains the selected mode", async () => {
    await mount(true, ["attendance", "check"]);
    const mode = host.querySelector<HTMLSelectElement>('select[name="action"]')!;
    await act(() => {
      mode.value = "check";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Start scanning")!
        .click(),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector(".pk-fast-scanner__label")?.textContent).toBe("Ready to scan");
    });
    const destroyed = mocks.cameraDestroyed.mock.calls.length;
    await act(async () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>(".pk-fast-scanner button"))
        .find((button) => button.textContent?.trim() === "Recent scans")!
        .click(),
    );
    expect(host.querySelector(".pk-fast-scanner")).toBeNull();
    expect(mocks.cameraDestroyed.mock.calls.length).toBeGreaterThan(destroyed);
    expect(host.querySelector<HTMLElement>("#scanner-scan-panel")!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>("#scanner-recent-panel")!.hidden).toBe(false);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Recent scans");
    expect(window.location.hash).toContain("scannerTab=recent");
    await act(async () => {
      Array.from(host.querySelectorAll('[role="tab"]'))
        .find((tab) => tab.textContent === "Scan")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector<HTMLElement>("#scanner-scan-panel")!.hidden).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('select[name="action"]')!.value).toBe("check");
    expect(window.location.hash).not.toContain("scannerTab=");
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  async function detectLead() {
    await mount(true, ["lead"], "99999999-9999-4999-8999-999999999999");
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Start scanning")!
        .click(),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector(".pk-fast-scanner__label")?.textContent).toBe("Ready to scan");
    });
    await act(async () => mocks.cameraScan!({ data: badgeCode }));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(scannerDialog("Review sponsor lead").open).toBe(true);
    });
    const dialog = scannerDialog("Review sponsor lead");
    Object.defineProperty(dialog, "close", { configurable: true, value: () => dialog.removeAttribute("open") });
    return dialog;
  }
  it("reviews a camera-detected lead in one dialog and records only explicitly confirmed attendee consent", async () => {
    const dialog = await detectLead();
    const consent = dialog.querySelector<HTMLInputElement>('input[name="consentConfirmed"]')!;
    const confirm = dialog.querySelector<HTMLButtonElement>(".pk-dialog__foot .pk-btn--primary")!;
    expect(host.querySelectorAll('input[name="consentConfirmed"]')).toHaveLength(1);
    expect(dialog.querySelector<HTMLInputElement>('input[name="badgeId"]')!.value).toBe(badgeCode);
    expect(consent.checked).toBe(false);
    expect(confirm.textContent).toBe("Confirm lead");
    await act(async () => confirm.click());
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(consent.getAttribute("aria-invalid")).toBe("true");
    expect(dialog.textContent).toContain("Confirm the attendee agrees");
    expect(host.textContent).not.toContain("Invalid QR code");
    await act(async () => consent.click());
    expect(consent.checked).toBe(true);
    await act(async () => confirm.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(dialog.open).toBe(false);
    });
    expect(mocks.persist).toHaveBeenCalledOnce();
    const captured = eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0][0]);
    expect(captured).toMatchObject({
      action: "lead",
      badgeId: badgeCode,
      sponsorId: "99999999-9999-4999-8999-999999999999",
      consentConfirmed: true,
    });
    await openManual("Review sponsor lead");
    expect(dialog.querySelector<HTMLInputElement>('input[name="consentConfirmed"]')!.checked).toBe(false);
  });
  it("refuses an open lead review after the canonical session owner changes", async () => {
    const session = (id: string, person: string) =>
      userAuthSessionResponseSchema.parse({
        success: true,
        sessionId: id,
        identity: { id: person, email: "synthetic@example.test" },
        eventParticipation: true,
        expiresAt: "2099-12-31T23:59:59.000Z",
        idleExpiresAt: "2099-12-31T23:59:59.000Z",
      });
    portalSession.value = session("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111");
    const dialog = await detectLead();
    const consent = dialog.querySelector<HTMLInputElement>('input[name="consentConfirmed"]')!;
    await act(async () => consent.click());
    expect(consent.checked).toBe(true);
    mocks.suspended.mockResolvedValue(true);
    await act(async () => {
      portalSession.value = session("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
      for (const listener of mocks.sessionListeners) listener();
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(dialog.querySelector<HTMLInputElement>('input[name="badgeId"]')!.value).toBe("");
    });
    expect(mocks.suspended).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(consent.checked).toBe(false);
    await act(async () => dialog.querySelector<HTMLButtonElement>(".pk-dialog__foot .pk-btn--primary")!.click());
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Sign in again to upload pending scans.");
  });
  it("validates the capture intent without guessing allocator sequence", async () => {
    await mount(true);
    await submit();
    expect(mocks.persist).toHaveBeenCalledOnce();
    const parsed = eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0]![0]);
    expect(parsed.badgeId).toBe(badgeCode);
    expect(parsed).not.toHaveProperty("scannerSession");
  });
  it("records from the single primary footer and refuses another form submission while the durable save is pending", async () => {
    await mount(true, ["attendance"]);
    const input = await openManual();
    await act(() => {
      input.value = badgeCode;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    let finish: (() => void) | undefined;
    mocks.persist.mockImplementation(async (scan) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { scan: eventScanCaptureIntentSchema.parse(scan), local: undefined };
    });
    const dialog = scannerDialog("Enter badge code");
    const confirm = dialog.querySelector<HTMLButtonElement>(".pk-dialog__foot .pk-btn--primary")!;
    expect(confirm.textContent).toBe("Record attendance");
    expect(dialog.querySelector(".pk-dialog__body button")).toBeNull();
    await act(() => {
      confirm.click();
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(confirm.disabled).toBe(true);
    expect(dialog.open).toBe(true);
    expect(input.value).toBe(badgeCode);
    const captured = eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0][0]);
    expect(captured.action).toBe("attendance");
    await act(async () => finish!());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(dialog.open).toBe(false);
    });
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
  it("freezes a zero-scan session and retries explicit close without enabling more capture", async () => {
    await mount(true);
    const frozen = { state: "closing", epochId: "77777777-7777-4777-8777-777777777777", issuedHighWater: 0 };
    mocks.freeze.mockResolvedValue(frozen);
    mocks.close.mockRejectedValueOnce(new Error("Server scanner coverage is incomplete"));
    await openDiagnostics();
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
    await closeDiagnostics();
    await submit();
    expect(mocks.persist).toHaveBeenCalledOnce();
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
      mocks.hardwareScan!(badgeCode);
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
    await openDiagnostics();
    const normal = Array.from(host.querySelectorAll("dl")).find((list) =>
      list.textContent?.includes("Last eligibility check"),
    )!;
    expect(normal.textContent).toContain("Last eligibility check");
    expect(normal.textContent).toContain(formatDateTime(mocks.snapshot.serverNow));
    await closeDiagnostics();
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
      expect(scannerDialog("Enter badge code").open).toBe(false);
      const input = await openManual();
      expect(input.value).toBe("");
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      expect(input.closest(".pk-field")?.className).not.toContain("pk-field--invalid");
      expect(host.querySelector(`.pk-event-scanner--${outcome}`)?.textContent).toContain("Captured observation");
      expect(mocks.persist).toHaveBeenCalledOnce();
      expect(eventScanCaptureIntentSchema.parse(mocks.persist.mock.calls[0][0]).badgeId).toBe(badgeCode);
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
    expect(host.querySelector<HTMLInputElement>('input[name="badgeId"]')!.value).toBe(badgeCode);
    expect(host.textContent).toContain("Unable to save this scan");
  });
  it("resets previous manual validation after successful continuous hardware capture", async () => {
    await mount(true, ["attendance"]);
    const input = await openManual();
    await act(async () => {
      input.value = "invalid badge";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await act(async () =>
      Array.from(scannerDialog("Enter badge code").querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Cancel")!
        .click(),
    );
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
      mocks.hardwareScan!(badgeCode);
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(mocks.persist).toHaveBeenCalledOnce();
      expect(host.querySelector(".pk-fast-scanner--unknown")?.textContent).toContain(
        "Unknown badge for this event snapshot",
      );
    });
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Exit")!
        .click(),
    );
    const cleared = await openManual();
    expect(cleared.value).toBe("");
    expect(cleared.hasAttribute("aria-invalid")).toBe(false);
    expect(cleared.closest(".pk-field")?.className).not.toContain("pk-field--invalid");
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
});
