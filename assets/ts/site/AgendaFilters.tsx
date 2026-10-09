import type { ContentAgendaDay } from "../../shared/site-agenda";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { IconFilterOff } from "../ui/MediaIcons";
import { Field } from "../ui/Field";
import { Select, TextInput } from "../ui/TextControl";
import "./AgendaFilters.css";

/** The published schedule is already present; these controls never fetch a roster. */
export function AgendaFilters({ days, id }: { days: readonly ContentAgendaDay[]; id?: string }) {
  const sessions = days.flatMap((day) => day.slots.flatMap((slot) => slot.sessions));
  const formats = [
    ...new Map(sessions.flatMap((session) => (session.format ? [[session.format.id, session.format]] : []))).values(),
  ];
  const tracks = [...new Set(sessions.flatMap((session) => (session.track ? [session.track] : [])))];
  return (
    <div class="pk-content-agenda__filter-controls" id={id}>
      {days.map((day, index) => (
        <div data-agenda-location-day={day.date} hidden={index !== 0} key={day.date}>
          <Button
            popovertarget={`agenda-locations-${day.date}`}
            aria-haspopup="dialog"
            aria-expanded="false"
            data-agenda-location-trigger
          >
            <span class="pk-content-agenda__location-dots" aria-hidden="true">
              {day.locations.map((location, color) => (
                <span class={`pk-content-agenda__location--${color % 7}`} key={location.id} />
              ))}
            </span>
            <span data-agenda-location-label>All locations</span>
            <span aria-hidden="true">▾</span>
          </Button>
          <div
            id={`agenda-locations-${day.date}`}
            popover="auto"
            role="dialog"
            aria-label="Filter locations"
            class="pk-content-agenda__location-popup"
          >
            <div class="pk-agenda-locations">
              <Field label={<span class="pk-sr-only">Find a location</span>}>
                {(control) => (
                  <TextInput {...control} type="search" data-agenda-location-search placeholder="Find a location" />
                )}
              </Field>
              <div class="pk-agenda-locations__actions">
                <Button variant="link" size="sm" data-agenda-locations-action="all" disabled={!day.locations.length}>
                  All locations
                </Button>
                <Button variant="link" size="sm" data-agenda-locations-action="clear" disabled={!day.locations.length}>
                  Clear
                </Button>
              </div>
              <div class="pk-agenda-locations__choices" role="group" aria-label="Locations">
                {day.locations.map((location, color) => (
                  <Checkbox
                    label={location.label}
                    defaultChecked
                    data-agenda-location={location.id}
                    class={`pk-agenda-locations__row pk-content-agenda__location pk-content-agenda__location--${color % 7}`}
                    key={location.id}
                  />
                ))}
              </div>
              <p
                class="pk-agenda-locations__empty"
                data-agenda-location-empty
                hidden={day.locations.length > 0}
                role="status"
              >
                {day.locations.length ? "No locations found." : "No locations for this day."}
              </p>
            </div>
          </div>
        </div>
      ))}
      {formats.length > 0 && (
        <Field label={<span class="pk-sr-only">Session type</span>}>
          {(control) => (
            <Select {...control} data-agenda-format-filter defaultValue="">
              <option value="">All session types</option>
              {formats.map((format) => (
                <option value={format.id} key={format.id}>
                  {format.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {tracks.length > 0 && (
        <Field label={<span class="pk-sr-only">Track</span>}>
          {(control) => (
            <Select {...control} data-agenda-track-filter defaultValue="">
              <option value="">All tracks</option>
              {tracks.map((track) => (
                <option value={track} key={track}>
                  {track}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label={<span class="pk-sr-only">Search sessions or speakers</span>}>
        {(control) => (
          <TextInput {...control} type="search" data-agenda-search placeholder="Search sessions or speakers" />
        )}
      </Field>
      <Button icon data-agenda-clear-filters aria-label="Clear filters" title="Clear filters" hidden>
        <IconFilterOff />
      </Button>
    </div>
  );
}
