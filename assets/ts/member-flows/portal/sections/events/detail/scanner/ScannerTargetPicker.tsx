import { contractClock } from "../../../../../../../shared/event-clock";
import { useEffect, useState } from "preact/hooks";
import type { ComponentProps } from "preact";
import {
  scannerTargetQuerySchema,
  scannerTargetsResponseSchema,
  type ScannerTargetsResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { eventFormsResponseSchema } from "../../../../../../../shared/schemas/forms";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { requestJson } from "../../../../../../shared/api-client";
import { ScannerLocationSelect } from "./ScannerLocationSelect";

/** Room/day filters stay on the bounded canonical session search. */
export function ScannerTargetPicker({
  timeWindow,
  ...location
}: ComponentProps<typeof ScannerLocationSelect> & { timeWindow?: "now" | "next" }) {
  const [catalog, setCatalog] = useState<ScannerTargetsResponse | null>(null);
  const [days, setDays] = useState<string[]>([]);
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
    void Promise.all([
      requestJson(
        `/api/v1/events/${encodeURIComponent(location.slug)}/scans/targets?limit=1`,
        scannerTargetsResponseSchema,
        { method: "GET", cache: "no-store", signal: controller.signal },
      ),
      timeWindow
        ? Promise.resolve(null)
        : requestJson(
            `/api/v1/events/${encodeURIComponent(location.slug)}/forms/placements/event_registration`,
            eventFormsResponseSchema,
            { method: "GET", cache: "no-store", signal: controller.signal },
          ),
    ])
      .then(([response, placement]) => {
        if (!controller.signal.aborted) {
          setCatalog(response);
          setDays(placement?.eventDays.map((day) => day.dayDate) ?? []);
          location.onTimeZone?.(contractClock(response));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Session filters are unavailable. Reconnect and try again.");
      });
    return () => controller.abort();
  }, [location.slug, timeWindow]);
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
          {timeWindow && (
            <p>
              {timeWindow === "now" ? "Sessions running now." : "Sessions starting later."} Choose a session and room
              for session attendance.
            </p>
          )}
          {!timeWindow && (
            <Field label="Day" {...filters.of("dayDate")}>
              {(control) => (
                <Select
                  {...control}
                  name="dayDate"
                  value={dayDate}
                  onChange={(event) => setDay(event.currentTarget.value)}
                >
                  <option value="">All event days</option>
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Select>
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
          {filters.valid && <ScannerLocationSelect {...location} params={params} timeZone={contractClock(catalog)} />}
        </>
      )}
    </div>
  );
}
