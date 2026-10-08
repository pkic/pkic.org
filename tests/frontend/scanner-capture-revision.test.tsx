import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventScanRequestSchema,
  type EventScanRequest,
} from "../../assets/shared/schemas/event-participation-scanning";
import type {
  EligibilityManifest,
  LocalEligibility,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest";
const queues = vi.hoisted(() => ({ scan: vi.fn() }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox", () => ({
  queueScan: queues.scan,
}));
import { useOfflineAdmission } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useOfflineAdmission";
const operator = "11111111-1111-4111-8111-111111111111",
  device = "22222222-2222-4222-8222-222222222222",
  badge = "ABCDEFGHJKLMNPQR",
  operation = "44444444-4444-4444-8444-444444444444",
  person = "55555555-5555-4555-8555-555555555555",
  sponsor = "66666666-6666-4666-8666-666666666666";
let host: HTMLElement;
let controller: ReturnType<typeof useOfflineAdmission>;
function request(action: EventScanRequest["action"]): EventScanRequest {
  return eventScanRequestSchema.parse({
    operatorUserId: operator,
    deviceId: device,
    badgeId: badge,
    operationId: operation,
    occurrenceId: null,
    action,
    observedAt: "2026-12-01T09:00:00.000Z",
    ...(action === "exception" ? { exceptionReason: "organizer_approval", recordAttendance: true } : {}),
    ...(action === "lead" ? { sponsorId: sponsor, consentConfirmed: true } : {}),
  });
}
function manifest(revision: number | null): EligibilityManifest {
  return {
    operatorUserId: operator,
    occurrenceId: null,
    publishedRevision: revision,
    serverNow: "2026-12-01T09:00:00.000Z",
    expiresAt: "2026-12-01T09:15:00.000Z",
    validUntil: Date.parse("2026-12-01T09:15:00.000Z"),
    lookup: vi.fn(async (): Promise<LocalEligibility> => ({
      outcome: "eligible",
      reason: "eligible",
      userId: person,
      message: "Eligible",
    })),
  };
}
async function mount(current: EligibilityManifest | null) {
  const reference = { current };
  host = document.createElement("div");
  document.body.append(host);
  function Harness() {
    controller = useOfflineAdmission("synthetic-event", operator, reference);
    return null;
  }
  await act(() => render(<Harness />, host));
  return reference;
}
beforeEach(() => {
  queues.scan.mockReset().mockImplementation(async (record) => {
    return eventScanRequestSchema.parse(record.scan);
  });
});
afterEach(() => {
  render(null, host);
  host.remove();
});
describe("immutable scanner capture publication", () => {
  it("preserves the captured native profile and IANA zone when a later manifest changes", async () => {
    const original = {
      ...manifest(null),
      nativeEventContext: { profileKey: "meeting" as const, timeZone: "Asia/Kuala_Lumpur" },
    };
    const reference = await mount(original);
    const captured = await controller.persist(request("attendance"));
    reference.current = {
      ...manifest(null),
      nativeEventContext: { profileKey: "board_meeting", timeZone: "Europe/Amsterdam" },
    };
    expect(captured.scan.nativeEventContext).toEqual({ profileKey: "meeting", timeZone: "Asia/Kuala_Lumpur" });
    expect(captured.scan.capturePublicationRevision).toBeNull();
    expect(queues.scan.mock.calls[0][0].scan.nativeEventContext).toEqual(original.nativeEventContext);
    expect(captured.scan).not.toHaveProperty("offlineRight");
  });
  it.each(["check", "admission", "attendance", "checkout", "lead", "exception"] as const)(
    "pins the prepared revision before queueing %s",
    async (action) => {
      await mount(manifest(7));
      const original = request(action);
      const saved = await controller.persist(original);
      expect(queues.scan).toHaveBeenCalledExactlyOnceWith({
        eventId: "synthetic-event",
        scan: { ...original, capturePublicationRevision: 7 },
      });
      expect(saved.scan).toEqual({ ...original, capturePublicationRevision: 7 });
      expect(original.capturePublicationRevision).toBeUndefined();
    },
  );
  it("preserves explicit no-publication context from an existing event manifest", async () => {
    await mount(manifest(null));
    const original = request("attendance");
    const saved = await controller.persist(original);
    expect(saved.scan.capturePublicationRevision).toBeNull();
    expect(queues.scan.mock.calls[0][0].scan.capturePublicationRevision).toBeNull();
  });
  it("does not invent a capture revision when no eligibility manifest exists", async () => {
    await mount(null);
    const original = request("checkout");
    const saved = await controller.persist(original);
    expect(saved.scan).toEqual(original);
    expect(Object.hasOwn(queues.scan.mock.calls[0][0].scan, "capturePublicationRevision")).toBe(false);
  });
  it.each(["eligible", "warning", "unknown"] as const)(
    "queues attendance with %s registration feedback without offline allocation",
    async (outcome) => {
      const prepared = manifest(8);
      const local: LocalEligibility = {
        outcome,
        reason:
          outcome === "eligible" ? "eligible" : outcome === "warning" ? "missing_registration" : "unknown_credential",
        ...(outcome !== "unknown" ? { userId: person } : {}),
        message: outcome === "warning" ? "Not registered" : outcome,
      };
      prepared.lookup = vi.fn(async () => local);
      await mount(prepared);
      const original = request("attendance");
      const saved = await controller.persist(original);
      expect(saved.scan).toEqual({ ...original, capturePublicationRevision: 8 });
      expect(saved.local).toEqual(local);
      expect(saved.scan.offlineRight).toBeUndefined();
      expect(queues.scan).toHaveBeenCalledExactlyOnceWith({ eventId: "synthetic-event", scan: saved.scan });
    },
  );
  it("keeps the manifest used at capture when a refresh completes during asynchronous badge lookup", async () => {
    const prepared = manifest(9);
    prepared.privateAccessRequired = true;
    let release!: (value: { outcome: "eligible"; reason: "eligible"; userId: string; message: string }) => void;
    prepared.lookup = vi.fn(
      () =>
        new Promise<LocalEligibility>((resolve) => {
          release = resolve;
        }),
    );
    const reference = await mount(prepared);
    const scan = request("attendance");
    const pending = controller.persist(scan);
    reference.current = manifest(10);
    release({ outcome: "eligible", reason: "eligible", userId: person, message: "Eligible" });
    const saved = await pending;
    expect(saved.scan.capturePublicationRevision).toBe(9);
    expect(queues.scan).toHaveBeenCalledExactlyOnceWith({
      eventId: "synthetic-event",
      scan: { ...scan, capturePublicationRevision: 9 },
    });
  });
});
