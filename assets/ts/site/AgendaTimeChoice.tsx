import { Field } from "../ui/Field";
import { Select } from "../ui/TextControl";
import { agendaZoneCity, agendaZoneOffset, AGENDA_COMMON_TIME_ZONES } from "../../shared/agenda-time-display";

/**
 * Native time-display choice; the existing clock owner synchronizes day headers.
 * "venue" keeps event time, "browser" follows the viewer's device and any other
 * value is an explicit IANA zone the viewer picked.
 */
export function AgendaTimeChoice({ timeZone, referenceDate }: { timeZone: string; referenceDate: string }) {
  const option = (zone: string, note?: string) =>
    `${agendaZoneCity(zone)} (${agendaZoneOffset(zone, referenceDate)})${note ? ` — ${note}` : ""}`;
  return (
    <div class="pk-content-agenda__time-choice" data-agenda-time-choice hidden>
      <Field label={<span data-agenda-time-mode>Event time</span>}>
        {(control) => (
          <span class="pk-content-agenda__time-picker">
            <span class="pk-content-agenda__time-face" data-agenda-time-face aria-hidden="true">
              {agendaZoneCity(timeZone)}
            </span>
            <Select
              {...control}
              data-agenda-time-select
              data-agenda-reference-date={referenceDate}
              aria-label="Show the agenda in a time zone"
              title={timeZone}
              defaultValue="venue"
            >
              <option value="venue" title={timeZone} data-agenda-zone-city={agendaZoneCity(timeZone)}>
                {option(timeZone, "event")}
              </option>
              <option value="browser" data-agenda-browser-option>
                Your device
              </option>
              {AGENDA_COMMON_TIME_ZONES.filter((zone) => zone !== timeZone).map((zone) => (
                <option value={zone} title={zone} data-agenda-zone-city={agendaZoneCity(zone)} key={zone}>
                  {option(zone)}
                </option>
              ))}
            </Select>
          </span>
        )}
      </Field>
    </div>
  );
}
