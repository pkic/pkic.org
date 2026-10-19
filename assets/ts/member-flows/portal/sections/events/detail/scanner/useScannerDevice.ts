import { useEffect, useState } from "preact/hooks";
import { prepareScannerDevice, prepareScannerEpoch, type ScannerEpoch } from "./scanner-device-ledger";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { readScannerOfflineEpoch } from "./scanner-offline-context";
export function useScannerDevice(
  slug: string,
  operatorUserId: string,
  sponsorId?: string,
  collector?: ScannerOfflineContext,
) {
  const [deviceId, setDeviceId] = useState("");
  const [epoch, setEpoch] = useState<ScannerEpoch | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
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
  }, [slug, operatorUserId, sponsorId, collector?.epochId, collector?.sessionId]);
  return { deviceId, epoch, setEpoch, error, ready: epoch?.state === "open" };
}
