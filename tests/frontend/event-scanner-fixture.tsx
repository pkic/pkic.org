vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  scannerUploadSuspended: mocks.suspended,
  subscribeUserSessionState: (listener: () => void) => {
    mocks.sessionListeners.add(listener);
    return () => {
      mocks.sessionListeners.delete(listener);
    };
  },
}));
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { badgeCredentialSchema } from "../../assets/shared/schemas/badge-credential";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, vi } from "vitest";
import {
  eventScanCaptureIntentSchema,
  type EventScanRequest,
} from "../../assets/shared/schemas/event-participation-scanning";
import type { ScannerQueueRecord } from "../../assets/shared/schemas/event-scanner-offline-queue";
export const badgeCode = badgeCredentialSchema.parse("ABCDEFGHJKLMNPQR");
const mocks = vi.hoisted(() => ({
  ready: false,
  state: "open",
  persist: vi.fn(),
  audit: vi.fn(async (record: unknown) => record),
  freeze: vi.fn(),
  close: vi.fn(),
  next: vi.fn(),
  drain: vi.fn(async (_send?: (record: ScannerQueueRecord) => Promise<Response>) => ({
    uploaded: 0,
    state: "complete",
  })),
  cameraDestroyed: vi.fn(),
  cameraScan: null as null | ((code: { data: string }) => void),
  suspended: vi.fn(async (_operatorUserId?: string, _sessionId?: string) => false),
  sessionListeners: new Set<() => void>(),
  hardwareScan: null as null | ((credential: string) => void),
  snapshot: null as null | { serverNow: string; expiresAt: string; validUntil: number },
}));
export { mocks };
// Receipt presentation uses synthetic hardware input; camera decoding has its own lifecycle and browser tests.
vi.mock("qr-scanner", () => ({
  default: class {
    constructor(_video: HTMLVideoElement, onDecode: (code: { data: string }) => void) {
      mocks.cameraScan = onDecode;
    }
    async start() {}
    destroy() {
      mocks.cameraDestroyed();
    }
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
vi.mock(
  "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest")
    >()),
    useEligibilityManifest: () => ({
      eligibilityManifest: { current: mocks.snapshot },
      manifestReady: true,
      manifestPreparing: false,
      manifestError: "",
    }),
  }),
);
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox", () => ({
  drainScanOutbox: mocks.drain,
  queueScannerAttempt: mocks.audit,
  scannerOperationRetained: vi.fn(async () => false),
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
export let host: HTMLDivElement;
afterEach(async () => {
  if (host) {
    await act(async () => render(null, host));
    host.remove();
  }
  portalSession.value = null;
  mocks.suspended.mockResolvedValue(false);
  mocks.sessionListeners.clear();
  mocks.cameraScan = null;
  mocks.snapshot = null;
  mocks.drain.mockImplementation(async () => ({ uploaded: 0, state: "complete" }));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
export async function mount(ready: boolean, actions: EventScanRequest["action"][] = ["check"], sponsorId?: string) {
  mocks.ready = ready;
  mocks.state = ready ? "open" : "preparing";
  host = document.createElement("div");
  document.body.append(host);
  mocks.persist.mockImplementation(async (scan) => ({
    scan: eventScanCaptureIntentSchema.parse(scan),
    local: undefined,
  }));
  await act(() => {
    render(
      <EventScanner
        slug="synthetic-event"
        operatorUserId="11111111-1111-4111-8111-111111111111"
        allowedActions={actions}
        sponsorId={sponsorId}
      />,
      host,
    );
  });
  expect(host.querySelector('[role="tabpanel"]#scanner-scan-panel')).not.toBeNull();
  const start = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Start scanning",
  )!;
  expect(start.disabled).toBe(!ready);
}
export function scannerDialog(title: string) {
  return Array.from(host.querySelectorAll<HTMLDialogElement>("dialog")).find(
    (dialog) => dialog.querySelector("h2")?.textContent === title,
  )!;
}
export async function openManual(title = "Enter badge code") {
  const dialog = scannerDialog(title);
  Object.defineProperty(dialog, "close", { configurable: true, value: () => dialog.removeAttribute("open") });
  await act(async () => {});
  if (!host.querySelector('input[name="badgeId"]'))
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Manual entry")!
        .click(),
    );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(dialog.open).toBe(true);
    expect(host.querySelector('input[name="badgeId"]')).not.toBeNull();
  });
  return host.querySelector<HTMLInputElement>('input[name="badgeId"]')!;
}
export async function openDiagnostics() {
  await act(async () => {
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.trim() === "Diagnostics")!
      .click();
  });
  const panel = host.querySelector<HTMLElement>('[aria-label="Recovery and diagnostics"]');
  expect(panel).not.toBeNull();
  return panel!;
}
export async function closeDiagnostics() {
  await act(async () => {
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.trim() === "Setup")!
      .click();
  });
  expect(host.querySelector('[aria-label="Recovery and diagnostics"]')).toBeNull();
}
export async function submit() {
  const input = await openManual();
  await act(async () => {
    input.value = badgeCode;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('form[aria-busy="true"]')).toBeNull();
  });
  await act(async () => {});
}
