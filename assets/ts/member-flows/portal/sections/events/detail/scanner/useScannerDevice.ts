import { useEffect, useRef, useState } from "preact/hooks";
import { prepareScannerDevice, prepareScannerEpoch, type ScannerEpoch } from "./scanner-device-ledger";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { readScannerOfflineEpoch } from "./scanner-offline-context";
export function useScannerDevice(
  slug: string,
  operatorUserId: string,
  sponsorId?: string,
  collector?: ScannerOfflineContext,
) {
  const context = useRef(collector);
  context.current = collector;
  const scope = collector
    ? JSON.stringify([
        collector.slug,
        collector.operatorUserId,
        collector.sessionId,
        collector.deviceId,
        collector.epochId,
        collector.action,
        collector.occurrenceId,
        collector.roomId,
        collector.serverNow,
      ])
    : null;
  const [deviceId, setDeviceId] = useState("");
  const [epoch, setEpoch] = useState<ScannerEpoch | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const collector = context.current;
    setEpoch(null);
    setDeviceId("");
    void (async () => {
      try {
        const device = collector?.deviceId ?? (await prepareScannerDevice(operatorUserId));
        const prepared = collector
          ? await readScannerOfflineEpoch(collector)
          : await prepareScannerEpoch(slug, operatorUserId, device, sponsorId);
        if (!active) return;
        setDeviceId(device);
        setEpoch(prepared);
        setError("");
      } catch {
        if (active) setError("Scanner preparation unavailable. Pending scans remain on this device.");
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, operatorUserId, sponsorId, scope]);
  async function reconcile() {
    if (!deviceId || collector) return;
    try {
      const refreshed = await prepareScannerEpoch(slug, operatorUserId, deviceId, sponsorId);
      setEpoch((current) => (current?.epochId === refreshed.epochId ? refreshed : current));
      setError("");
    } catch {
      setError(
        "Scanner session status could not be refreshed. Reconnect and reopen the scanner; pending scans remain on this device.",
      );
    }
  }
  return { deviceId, epoch, setEpoch, reconcile, error, ready: epoch?.state === "open" };
}
