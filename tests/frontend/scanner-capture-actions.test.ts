import { describe, expect, it, vi } from "vitest";
import { eventScanCaptureIntentSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { createScannerCaptureActions } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/createScannerCaptureActions";
import { ScannerCapturePersistenceError } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerFailureCapture";

type Options = Parameters<typeof createScannerCaptureActions>[0];
const credential = "ABCDEFGHJKLMNPQR";
const scan = eventScanCaptureIntentSchema.parse({
  operationId: "11111111-1111-4111-8111-111111111111",
  operatorUserId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
  badgeId: credential,
  scannedValue: credential,
  scannedValueTruncated: false,
  occurrenceId: null,
  roomId: null,
  action: "attendance",
  observedAt: "2026-12-01T08:00:00.000Z",
});
function setup() {
  const held = { current: false };
  const options = {
    requestCapture: () => true,
    captureAllowed: () => true,
    manualCapturePending: { current: false },
    collection: {
      held,
      begin: vi.fn(() => {
        held.current = true;
      }),
      clear: vi.fn(() => {
        held.current = false;
      }),
    },
    form: { submit: () => ({ data: scan, formMessage: null }) },
    auditFailure: vi.fn(async () => true),
    badgeId: credential,
    lastOperation: { current: null as string | null },
    setMessage: vi.fn(),
    action: "attendance" as const,
    setResult: vi.fn(),
    operationId: scan.operationId,
    setBusy: vi.fn(),
    persistCapture: vi.fn<Options["persistCapture"]>(async (value) => ({ scan: value, local: undefined })),
    scanSaved: vi.fn(async () => {}),
    resetCaptureFields: vi.fn(),
    presentSavedEligibility: vi.fn(async () => true),
    verifyQueuedScan: vi.fn(async () => true),
    fastMode: true,
    feedbackHeld: false,
    manualOpen: true,
    cooldown: {
      remainingMs: 0,
      saving: false,
      durationMs: 300,
      ready: () => true,
      accept: () => true,
      feedback: vi.fn(),
      skip: vi.fn(),
      reset: vi.fn(),
    },
    camera: vi.fn(async () => {}),
    failure: vi.fn(),
    operatorPaused: { current: false },
    manualPaused: { current: false },
    scannerContext: {
      current: {
        targetId: null,
        action: "attendance" as const,
        operatorUserId: scan.operatorUserId,
        deviceId: scan.deviceId,
        roomId: null,
        rooms: [],
      },
    },
    badgeCamera: { stop: vi.fn(), acceptsFrame: () => true } as unknown as Options["badgeCamera"],
    manual: { setOpen: vi.fn(), setFocusRequested: vi.fn() } as unknown as Options["manual"],
    setBadge: vi.fn(),
    setFastMode: vi.fn(),
    consentConfirmed: false,
    showProvisionalMessage: vi.fn(),
  } satisfies Options;
  const actions = createScannerCaptureActions(options);
  return { options, actions };
}
const captureTypes = ["manual", "hardware", "camera"] as const;
function invoke(actions: ReturnType<typeof createScannerCaptureActions>, type: (typeof captureTypes)[number]) {
  return type === "manual" ? actions.capture() : actions.scanCredential(credential, type === "camera");
}
describe("badge collection persistence boundary", () => {
  it.each(captureTypes)("allows retry after a confirmed unsaved %s capture", async (type) => {
    const { options, actions } = setup();
    options.persistCapture.mockRejectedValueOnce(new ScannerCapturePersistenceError("Scan not saved", true, null));
    await invoke(actions, type);
    expect(options.collection.held.current).toBe(false);
    expect(options.collection.clear).toHaveBeenCalledOnce();
    expect(options.resetCaptureFields).not.toHaveBeenCalled();
    expect(options.manualCapturePending.current).toBe(false);
    if (type !== "manual") expect(options.setBadge).toHaveBeenCalledWith(credential);
    await invoke(actions, type);
    expect(options.persistCapture).toHaveBeenCalledTimes(2);
    expect(options.collection.held.current).toBe(true);
  });
  it.each(captureTypes)("keeps a saved %s capture held if later feedback fails", async (type) => {
    const { options, actions } = setup();
    options.presentSavedEligibility.mockRejectedValueOnce(new Error("Feedback interrupted"));
    await invoke(actions, type);
    expect(options.collection.held.current).toBe(true);
    expect(options.collection.clear).not.toHaveBeenCalled();
    await invoke(actions, type);
    expect(options.persistCapture).toHaveBeenCalledOnce();
  });
  it.each(captureTypes)("keeps a saved %s capture held if post-save bookkeeping fails", async (type) => {
    const { options, actions } = setup();
    options.scanSaved.mockRejectedValueOnce(new Error("Bookkeeping interrupted"));
    await invoke(actions, type);
    expect(options.collection.held.current).toBe(true);
    expect(options.collection.clear).not.toHaveBeenCalled();
    await invoke(actions, type);
    expect(options.persistCapture).toHaveBeenCalledOnce();
  });
  it.each(captureTypes)("keeps a %s capture held when persistence cannot safely be retried", async (type) => {
    const { options, actions } = setup();
    options.persistCapture.mockRejectedValueOnce(
      new ScannerCapturePersistenceError("Save already retained or uncertain", false, null),
    );
    await invoke(actions, type);
    expect(options.collection.held.current).toBe(true);
    expect(options.collection.clear).not.toHaveBeenCalled();
    await invoke(actions, type);
    expect(options.persistCapture).toHaveBeenCalledOnce();
  });
});
