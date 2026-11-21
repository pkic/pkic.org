import { act } from "preact/test-utils";
import { render } from "preact";
import { expect, it, vi } from "vitest";
import { eventScanRequestSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { withScannedInput } from "../helpers/scanned-input";
import { useScannerAdmissionException } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerAdmissionException";
import { badgeCode, host, mocks, mount } from "./event-scanner-fixture";

it("offers admission exception review only to permitted staff and saves the reviewed badge", async () => {
  await mount(true, ["attendance", "exception"], undefined, undefined, true);
  mocks.persist.mockImplementation(async (input) => ({
    scan: eventScanRequestSchema.parse(input),
    local: { outcome: "warning", reason: "missing_registration", message: "Registration required" },
  }));
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Start scanning")!
      .click();
  });
  await act(async () => mocks.hardwareScan!(badgeCode));
  const scanner = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Continuous badge scanner"]')!;
  await vi.waitFor(() => expect(scanner.textContent).toContain("Review admission exception"));
  await act(async () => scanner.querySelector<HTMLButtonElement>('[aria-label="Operator controls"]')!.click());
  const drawer = scanner.querySelector<HTMLElement>('[role="dialog"][aria-label="Scanner operator controls"]')!;
  const review = [...drawer.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Review admission exception",
  );
  expect(review).toBeDefined();
  await act(async () => review!.click());
  await act(async () => {
    drawer.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(mocks.persist).toHaveBeenCalledTimes(2));
  const saved = eventScanRequestSchema.parse(mocks.persist.mock.calls[1]![0]);
  expect(saved).toMatchObject({ action: "exception", badgeId: badgeCode, exceptionReason: "organizer_approval" });
});

it("keeps admission exception review unavailable without the exception permission", async () => {
  await mount(true, ["attendance", "exception"]);
  mocks.persist.mockImplementation(async (input) => ({
    scan: eventScanRequestSchema.parse(input),
    local: { outcome: "warning", reason: "missing_registration", message: "Registration required" },
  }));
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Start scanning")!
      .click();
  });
  await act(async () => mocks.hardwareScan!(badgeCode));
  const scanner = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Continuous badge scanner"]')!;
  await vi.waitFor(() => expect(scanner.textContent).toContain("Verification pending"));
  await act(async () => scanner.querySelector<HTMLButtonElement>('[aria-label="Operator controls"]')!.click());
  expect(scanner.textContent).not.toContain("Review admission exception");
});

it("does not replace a newer scan when an admission exception finishes saving late", async () => {
  const source = eventScanRequestSchema.parse(
    withScannedInput({
      operatorUserId: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222",
      badgeId: badgeCode,
      operationId: "33333333-3333-4333-8333-333333333333",
      occurrenceId: null,
      action: "attendance",
      observedAt: "2026-11-21T09:00:00.000Z",
    }),
  );
  const lastOperation = { current: source.operationId };
  const scanSaved = vi.fn(async () => {});
  const presentSavedEligibility = vi.fn(async () => true);
  let finishSave!: (saved: { scan: typeof source }) => void;
  const persistCapture = vi.fn(() => new Promise<{ scan: typeof source }>((resolve) => (finishSave = resolve)));
  let exception!: ReturnType<typeof useScannerAdmissionException>;
  function Harness() {
    exception = useScannerAdmissionException({
      allowed: true,
      action: "attendance",
      result: {
        operationId: source.operationId,
        outcome: "warning",
        reason: "missing_registration",
        recorded: false,
        attendanceRecorded: false,
      },
      captureAllowed: () => true,
      persistCapture,
      scanSaved,
      lastOperation,
      presentSavedEligibility,
      verifyQueuedScan: async () => false,
      setBusy: vi.fn(),
    });
    return null;
  }
  const root = document.createElement("div");
  try {
    await act(async () => render(<Harness />, root));
    await act(async () => exception.remember(source));
    await act(async () => render(<Harness />, root));
    const submitted = exception.request!;
    const pending = exception.confirm(submitted);
    await vi.waitFor(() => expect(persistCapture).toHaveBeenCalledOnce());
    await act(async () => exception.remember({ ...source, operationId: crypto.randomUUID() }));
    finishSave({ scan: submitted });
    await act(async () => pending);
    expect(lastOperation.current).toBe(source.operationId);
    expect(scanSaved).toHaveBeenCalledOnce();
    expect(presentSavedEligibility).not.toHaveBeenCalled();
  } finally {
    await act(async () => render(null, root));
  }
});
