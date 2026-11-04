import { contractClock, clockTimeZone } from "../../../../../../../shared/event-clock";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentProps } from "preact";
import {
  scannerTargetQuerySchema,
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
  catalog,
  selectedRoomId = "",
  ...location
}: ComponentProps<typeof ScannerLocationSelect> & {
  timeWindow?: "now" | "next";
  catalog: ScannerTargetsResponse | null;
  selectedRoomId?: string;
}) {
  const [days, setDays] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [dayDate, setDay] = useState("");
  const roomId = selectedRoomId;
  const filters = useContractForm(scannerTargetQuerySchema, {
    ...(dayDate ? { dayDate } : {}),
    ...(roomId ? { roomId } : {}),
    ...(timeWindow ? { timeWindow } : {}),
  });
  const onTimeZone = useRef(location.onTimeZone);
  onTimeZone.current = location.onTimeZone;
  useEffect(() => {
    if (catalog) onTimeZone.current?.(contractClock(catalog));
    const controller = new AbortController();
    setDays([]);
    setError("");
    if (!timeWindow)
      void requestJson(
        `/api/v1/events/${encodeURIComponent(location.slug)}/forms/placements/event_registration`,
        eventFormsResponseSchema,
        { method: "GET", cache: "no-store", signal: controller.signal },
      )
        .then((placement) => {
          if (!controller.signal.aborted) setDays(placement.eventDays.map((day) => day.dayDate));
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("Event days are unavailable. You can still search sessions.");
        });
    return () => controller.abort();
  }, [location.slug, timeWindow, catalog]);
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
          <small class="pk-muted">{clockTimeZone(contractClock(catalog))}</small>
          {timeWindow && (
            <p>{timeWindow === "now" ? "Choose a session running now." : "Choose an upcoming session."}</p>
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
          {filters.valid && (
            <ScannerLocationSelect {...location} params={params} timeZone={contractClock(catalog)} allowEmpty={false} />
          )}
        </>
      )}
    </div>
  );
}
