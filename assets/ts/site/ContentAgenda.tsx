import { useEffect, useRef } from "preact/hooks";
import "../../design/tokens.agenda.generated.css";
import { formatTimeRangeInZone } from "../../shared/format-date";
import type { ComponentChildren } from "preact";
import "./ContentAgenda.css";
import { LocalTime } from "./SiteDate";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Select } from "../ui/TextControl";
import { StrokeIcon } from "../ui/MediaIcons";
import { AgendaSession, AgendaSpeaker, ClockIcon, type AgendaSessionEditor } from "./AgendaSession";
import { agendaRows } from "./agenda-layout";
import { agendaFragmentRegistry } from "./agenda-fragments";
import { legacyAgendaFragmentMatchesPlacement } from "../../shared/legacy-agenda-fragments";
import type { ContentAgendaDay, ContentAgendaSpeaker, ContentAgendaSpeakerFragment } from "../../shared/site-agenda";

export function ContentAgenda({
  days,
  speakers,
  timeZone,
  editor,
  fragmentNavigation = false,
  legacySpeakerFragments = [],
}: {
  days: ContentAgendaDay[];
  speakers: ContentAgendaSpeaker[];
  timeZone: string;
  /** Only public pages own the URL fragment; portal views use their hash router. */
  fragmentNavigation?: boolean;
  legacySpeakerFragments?: readonly ContentAgendaSpeakerFragment[];
  editor?: {
    session: (id: string) => AgendaSessionEditor;
    dropTarget: (startsAt: string, roomId: string) => ComponentChildren;
  };
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    // Static pages use the same initializer through the module loader.
    // A portal view can mount after that initial document scan.
    if (typeof ResizeObserver !== "undefined") {
      void import("./agenda").then(({ initializeContentAgenda }) => {
        if (active && root.current) dispose = initializeContentAgenda(root.current);
      });
    }
    return () => {
      active = false;
      dispose?.();
    };
  }, []);
  useEffect(() => {
    if (editor) return;
    let active = true;
    let dispose: (() => void) | undefined;
    void import("../../js/modules/local-time.js").then(({ initLocalTime }) => {
      if (active && root.current) dispose = initLocalTime(root.current);
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [days, timeZone, editor]);
  if (!days.length) return null;
  const venueLabel = timeZone.split("/").slice(1).join(" / ").replaceAll("_", " ") || timeZone;
  const fragments = agendaFragmentRegistry(days, legacySpeakerFragments, editor ? 80 : 0);
  return (
    <section
      ref={root}
      class="pk-content-agenda"
      aria-label="Event agenda"
      data-module="site/agenda"
      data-agenda-time-zone={editor ? undefined : timeZone}
      data-agenda-time-display={editor ? undefined : "venue"}
      data-agenda-public-fragments={fragmentNavigation && !editor ? "" : undefined}
    >
      <h2 class="pk-sr-only">Event agenda</h2>
      {!editor && (
        <div class="pk-content-agenda__tabs" role="tablist" aria-label="Agenda days">
          {days.map((day, dayIndex) => (
            <button
              class={dayIndex === 0 ? "is-active" : undefined}
              type="button"
              role="tab"
              id={`agenda-tab-${day.date}`}
              aria-controls={`agenda-day-${day.date}`}
              aria-selected={dayIndex === 0 ? "true" : "false"}
              data-agenda-tab={day.date}
              key={day.date}
            >
              <LocalTime value={day.date} format="weekday" />
            </button>
          ))}
          <button
            type="button"
            role="tab"
            id="agenda-tab-speakers"
            aria-controls="agenda-speakers"
            aria-selected="false"
            data-agenda-tab="speakers"
          >
            Speakers
          </button>
        </div>
      )}
      <div class="pk-content-agenda__controls" data-agenda-controls hidden>
        {!editor && (
          <div class="pk-content-agenda__time-choice" data-agenda-time-choice hidden>
            <Field label="Times">
              {(control) => (
                <Select {...control} data-agenda-time-select aria-label="Agenda time display" defaultValue="venue">
                  <option value="venue">Event time · {venueLabel}</option>
                  <option value="browser">Your browser time</option>
                </Select>
              )}
            </Field>
          </div>
        )}
        <Button
          variant="secondary"
          icon
          data-agenda-scroll="-1"
          aria-label="Scroll agenda left"
          title="Scroll agenda left"
        >
          <StrokeIcon>
            <path d="m10 3-5 5 5 5" />
          </StrokeIcon>
        </Button>
        <Button
          variant="secondary"
          icon
          data-agenda-scroll="1"
          aria-label="Scroll agenda right"
          title="Scroll agenda right"
        >
          <StrokeIcon>
            <path d="m6 3 5 5-5 5" />
          </StrokeIcon>
        </Button>
        <Button
          variant="secondary"
          icon
          data-agenda-compact
          aria-pressed="false"
          aria-label="Compact agenda"
          title="Compact agenda"
        >
          <StrokeIcon>
            <path d="m4 2 4 4 4-4M4 14l4-4 4 4" />
          </StrokeIcon>
        </Button>
        <Button
          variant="secondary"
          icon
          data-agenda-expand
          aria-expanded="false"
          aria-label="Expand agenda"
          title="Expand agenda"
        >
          <StrokeIcon>
            <path d="M2 6V2h4m4 0h4v4M2 10v4h4m4 0h4v-4" />
          </StrokeIcon>
        </Button>
      </div>
      {days.map((day) => (
        <section
          class="pk-content-agenda__day"
          id={`agenda-day-${day.date}`}
          role={editor ? undefined : "tabpanel"}
          aria-label={editor ? `Agenda for ${day.date}` : undefined}
          aria-labelledby={editor ? undefined : `agenda-tab-${day.date}`}
          data-agenda-panel={day.date}
          key={day.date}
        >
          {(day.legacyFragments ?? []).map(
            (fragment) =>
              fragments.takeAlias(fragment.anchor) && (
                <span key={fragment.anchor} id={fragment.anchor} hidden data-agenda-fragment-panel={day.date} />
              ),
          )}
          <div class="pk-content-agenda__filters" aria-label="Filter locations">
            <button type="button" class="is-active" aria-pressed="true" data-agenda-location="all">
              All locations
            </button>
            {day.locations.map((location, index) => (
              <button
                type="button"
                aria-pressed="true"
                aria-label={location.label}
                class={`pk-content-agenda__location pk-content-agenda__location--${index % 7} is-active`}
                data-agenda-location={location.id}
                key={location.id}
              >
                {location.label}
              </button>
            ))}
          </div>
          {Boolean(day.staffing?.length) && (
            <div class="pk-content-agenda__staffing" aria-label="Block hosts and question support">
              {day.staffing!.map((block) => (
                <section class="pk-content-agenda__staffing-block" key={block.id}>
                  <strong>{block.name}</strong>
                  <small>
                    {formatTimeRangeInZone(block.startAt, block.endAt, timeZone)}
                    {block.locationId
                      ? ` · ${day.locations.find((room) => room.id === block.locationId)?.label ?? ""}`
                      : ""}
                    {block.track ? ` · Track: ${block.track}` : ""}
                  </small>
                  <ul>
                    {block.duties.map((duty) => (
                      <li key={`${duty.role}:${duty.displayName}`}>
                        <span>
                          {duty.role === "mc"
                            ? "MC"
                            : duty.role === "room_qa"
                              ? "Room Q&A"
                              : duty.role === "remote_qa"
                                ? "Remote Q&A"
                                : duty.role.replaceAll("_", " ")}
                        </span>{" "}
                        {duty.displayName}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <table class="pk-content-agenda__timeline">
            <caption class="pk-sr-only">
              Agenda for {day.date}, times in {timeZone}
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                {day.locations.map((location) => (
                  <th scope="col" key={location.id}>
                    {location.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agendaRows(day, editor ? 80 : 0).map(({ slot, cells, height }, slotIndex) => (
                <tr class="pk-content-agenda__slot" data-agenda-height={height} key={`${slot.time}-${slotIndex}`}>
                  <th scope="row" class="pk-content-agenda__time">
                    <div class="pk-content-agenda__clocks">
                      <div class="pk-content-agenda__clock" aria-label="Event time" data-agenda-clock="venue">
                        <time dateTime={slot.startsAt}>{slot.time}</time>
                        <small title={timeZone}>Event · {venueLabel}</small>
                      </div>
                      {!editor && (
                        <div
                          class="pk-content-agenda__clock"
                          aria-label="Your time"
                          data-agenda-clock="browser"
                          data-local-time-container
                          data-event-time-zone={timeZone}
                          hidden
                        >
                          <small data-agenda-browser-zone>Your time</small>
                          <LocalTime value={slot.startsAt} format="time" />
                          <small data-agenda-local-date hidden />
                        </div>
                      )}
                    </div>
                    {editor?.dropTarget(slot.startsAt, "")}
                  </th>
                  {slot.sessions.length || editor || cells.some((cell) => cell === null) ? (
                    cells.map(
                      (cell, locationIndex) =>
                        cell && (
                          <td
                            class="pk-content-agenda__cell"
                            rowSpan={cell.rowSpan}
                            data-agenda-cell={day.locations[locationIndex]?.id}
                            key={locationIndex}
                          >
                            {editor?.dropTarget(slot.startsAt, day.locations[locationIndex]?.id ?? "")}
                            {cell.sessions.map((session, sessionIndex) => (
                              <AgendaSession
                                session={session}
                                legacyFragments={(session.legacyFragments ?? []).filter(
                                  (fragment) =>
                                    legacyAgendaFragmentMatchesPlacement(
                                      fragment,
                                      session,
                                      day.locations[locationIndex]?.id,
                                      locationIndex,
                                    ) && fragments.takeAlias(fragment.anchor),
                                )}
                                publicAnchor={
                                  locationIndex ===
                                  Math.max(
                                    0,
                                    day.locations.findIndex((location) => location.id === session.locations[0]),
                                  )
                                    ? fragments.takePrimary(session.publicAnchor)
                                    : undefined
                                }
                                editor={editor && session.id ? editor.session(session.id) : undefined}
                                slot={slot}
                                locations={day.locations}
                                timeZone={timeZone}
                                dialogId={`agenda-session-${day.date}-${slotIndex}-${locationIndex}-${sessionIndex}`}
                                key={session.id ? `${session.id}:${day.locations[locationIndex]?.id}` : sessionIndex}
                              />
                            ))}
                          </td>
                        ),
                    )
                  ) : (
                    <td
                      class={slot.title || slot.durationMinutes ? undefined : "pk-content-agenda__cell"}
                      colSpan={Math.max(1, day.locations.length)}
                    >
                      {slot.title || slot.durationMinutes ? (
                        <div class="pk-content-agenda__break">
                          <strong>{slot.title}</strong>
                          {slot.durationMinutes ? (
                            <span>
                              <ClockIcon /> {slot.durationMinutes} min
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {!editor && (
        <section
          class="pk-content-agenda__speakers"
          id="agenda-speakers"
          role="tabpanel"
          aria-labelledby="agenda-tab-speakers"
          data-agenda-panel="speakers"
        >
          {legacySpeakerFragments.map(
            (fragment) =>
              fragments.takeAlias(fragment.anchor) && (
                <span key={fragment.anchor} id={fragment.anchor} hidden data-agenda-fragment-panel="speakers" />
              ),
          )}
          {speakers.map((speaker) => (
            <article key={speaker.name}>
              <AgendaSpeaker speaker={speaker} detail />
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
