import {
  boundedScannedValue,
  type scannerFailureReasonSchema,
} from "../../../../../../../shared/schemas/scanner-attempt-capture";
import type { z } from "zod";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import type { ScannerFailureCapture } from "../../../../../../../shared/schemas/event-scanner-offline-queue";
import { portalSession } from "../../../../state";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { queueScannerAttempt, scannerOperationRetained } from "./scan-outbox";

/** Local refusals share the atomic epoch ledger and durable retry queue with accepted scans. */
export function useScannerFailureCapture(
  slug: string,
  context: () => Omit<
    ScannerFailureCapture,
    "operationId" | "observedAt" | "reason" | "scannedValue" | "scannedValueTruncated"
  >,
  collector: ScannerOfflineContext | undefined,
  effects: { saved: () => Promise<void>; unsaved: () => void },
) {
  return async (
    raw: string | ReturnType<typeof boundedScannedValue>,
    reason: z.infer<typeof scannerFailureReasonSchema>,
  ) => {
    const record = {
      kind: "failure" as const,
      eventId: slug,
      scan: {
        ...context(),
        ...(typeof raw === "string" ? boundedScannedValue(raw) : raw),
        reason,
        operationId: crypto.randomUUID(),
        observedAt: new Date().toISOString(),
      },
    };
    try {
      await queueScannerAttempt(record, collector?.sessionId ?? portalSession.value?.sessionId, collector);
      await effects.saved();
      return true;
    } catch {
      effects.unsaved();
      return false;
    }
  };
}

/** A failed save does not prove that a normal operation is absent from durable storage. */
export async function persistScannerCapture<T>(
  scan: EventScanRequest,
  eventId: string,
  persist: (scan: EventScanRequest) => Promise<T>,
  auditFailure: ReturnType<typeof useScannerFailureCapture>,
): Promise<T> {
  try {
    return await persist(scan);
  } catch (error) {
    const retained = await scannerOperationRetained(scan.operationId, scan.operatorUserId, eventId).catch(() => null);
    if (retained !== false)
      throw new Error(
        retained
          ? "This scan is already retained. Check Recent scans before retrying; no duplicate failure audit was added."
          : "The scan save could not be confirmed. The failure audit was not saved. Keep the scanned value and check recovery before retrying.",
        { cause: error },
      );
    const saved = await auditFailure(scan, "storage_unavailable");
    throw new Error(
      saved
        ? "Scan was not saved. The failure audit is saved for upload; retry the scan."
        : "The scan and its audit were not saved. Keep the scanned value and retry when device storage is available.",
      { cause: error },
    );
  }
}
