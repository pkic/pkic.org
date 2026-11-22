import {
  scannerDeviceSessionResumptionSchema,
  scannerDeviceSessionStatusSchema,
} from "../../../../../../../shared/schemas/event-scanner-devices";

/** Shared by the page and background worker; keep page-only API dependencies out of this path. */
export async function resumeScannerServerSession(
  eventId: string,
  epochId: string,
  deviceId: string,
  sponsorId?: string,
) {
  const response = await fetch(
    `/api/v1/events/${encodeURIComponent(eventId)}/scanner/devices/sessions/${encodeURIComponent(epochId)}/resumption`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        scannerDeviceSessionResumptionSchema.parse({ deviceId, ...(sponsorId ? { sponsorId } : {}) }),
      ),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error(`Scanner session recovery failed (HTTP ${response.status}).`);
  const status = scannerDeviceSessionStatusSchema.parse(await response.json());
  if (status.epochId !== epochId || status.deviceId !== deviceId || status.closedAt || status.closingDeclaredAt)
    throw new Error("Scanner session could not be resumed");
  return status;
}
