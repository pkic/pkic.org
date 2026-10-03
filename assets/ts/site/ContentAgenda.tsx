import type { ComponentChildren, JSX } from "preact";
import "./ContentAgenda.css";
import { LocalTime } from "./SiteDate";
import { Button } from "../ui/Button";
import { StrokeIcon } from "../ui/MediaIcons";
import { AgendaSession, AgendaSpeaker, ClockIcon } from "./AgendaSession";
import { agendaRows } from "./agenda-layout";
import type { ContentAgendaDay, ContentAgendaSpeaker } from "../../shared/site-agenda";

export function ContentAgenda({
  days,
  speakers,
  timeZone,
  editor,
}: {
  days: ContentAgendaDay[];
  speakers: ContentAgendaSpeaker[];
  timeZone: string;
  editor?: {
    session: (id: string) => {
      controls: ComponentChildren;
      resizeHandle?: ComponentChildren;
      onDragStart?: JSX.DragEventHandler<HTMLElement>;
      onOpen?: () => void;
    };
    dropTarget: (startsAt: string, roomId: string) => ComponentChildren;
  };
}) {
  if (!days.length) return null;
  const venueLabel = timeZone.split("/").slice(1).join(" / ").replaceAll("_", " ") || timeZone;
  return (
    <section class="pk-content-agenda" aria-label="Event agenda" data-module="site/agenda">
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
                    <div class="pk-content-agenda__clock" aria-label="Event time">
                      <time dateTime={slot.startsAt}>{slot.time}</time>
                      <small title={timeZone}>Event · {venueLabel}</small>
                    </div>
                    <div
                      class="pk-content-agenda__clock"
                      aria-label="Your time"
                      data-local-time-container
                      data-event-time-zone={timeZone}
                      hidden
                    >
                      <small>Your time</small>
                      <LocalTime value={slot.startsAt} format="time" />
                    </div>
                  </th>
                  {slot.sessions.length || editor ? (
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
                                editor={editor && session.id ? editor.session(session.id) : undefined}
                                slot={slot}
                                locations={day.locations}
                                timeZone={timeZone}
                                dialogId={`agenda-session-${day.date}-${slotIndex}-${locationIndex}-${sessionIndex}`}
                                key={sessionIndex}
                              />
                            ))}
                          </td>
                        ),
                    )
                  ) : (
                    <td colSpan={Math.max(1, day.locations.length)}>
                      <div class="pk-content-agenda__break">
                        <strong>{slot.title}</strong>
                        {slot.durationMinutes ? (
                          <span>
                            <ClockIcon /> {slot.durationMinutes} min
                          </span>
                        ) : null}
                      </div>
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
