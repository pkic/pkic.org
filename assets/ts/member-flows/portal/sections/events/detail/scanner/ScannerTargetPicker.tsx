import { useEffect, useState } from "preact/hooks";
import type { ComponentProps } from "preact";
import {
  scannerTargetQuerySchema,
  scannerTargetsResponseSchema,
  type ScannerTargetsResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { requestJson } from "../../../../../../shared/api-client";
import { ScannerLocationSelect } from "./ScannerLocationSelect";

/** Room/day filters stay on the bounded canonical session search. */
export function ScannerTargetPicker({
  timeWindow,
  ...location
}: ComponentProps<typeof ScannerLocationSelect> & { timeWindow?: "now" | "next" }) {
  const [catalog, setCatalog] = useState<ScannerTargetsResponse | null>(null);
  const [error, setError] = useState("");
  const [dayDate, setDay] = useState("");
  const [roomId, setRoom] = useState("");
  const filters = useContractForm(scannerTargetQuerySchema, {
    ...(dayDate ? { dayDate } : {}),
    ...(roomId ? { roomId } : {}),
    ...(timeWindow ? { timeWindow } : {}),
  });
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setError("");
    void requestJson(
      `/api/v1/events/${encodeURIComponent(location.slug)}/scans/targets?limit=1`,
      scannerTargetsResponseSchema,
      { method: "GET", cache: "no-store", signal: controller.signal },
    )
      .then((response) => {
        if (!controller.signal.aborted) {
          setCatalog(response);
          location.onTimeZone?.(response.timeZone);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Session filters are unavailable. Reconnect and try again.");
      });
    return () => controller.abort();
  }, [location.slug]);
  const params: Record<string, string> = {
    ...(dayDate ? { dayDate } : {}),
    ...(roomId ? { roomId } : {}),
    ...(timeWindow ? { timeWindow } : {}),
  };
  return (
    <div class="pk-form" {...filters.handlers}>
      {error && <p role="status">{error}</p>}
      {catalog && (
        <>
          <small class="pk-muted">{catalog.timeZone}</small>
          {!timeWindow && (
            <Field label="Day" {...filters.of("dayDate")}>
              {(control) => (
                <TextInput
                  {...control}
                  type="date"
                  name="dayDate"
                  value={dayDate}
                  onInput={(event) => setDay(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
          <Field label="Room" {...filters.of("roomId")}>
            {(control) => (
              <Select
                {...control}
                name="roomId"
                value={roomId}
                onChange={(event) => setRoom(event.currentTarget.value)}
              >
                <option value="">All rooms</option>
                {catalog.rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {catalog.roomsTruncated && (
            <p>More rooms exist. Use session search to find sessions outside these room filters.</p>
          )}
          {filters.valid && <ScannerLocationSelect {...location} params={params} timeZone={catalog.timeZone} />}
        </>
      )}
    </div>
  );
}
