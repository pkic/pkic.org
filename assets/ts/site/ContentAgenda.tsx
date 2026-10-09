import { agendaSpeakerSessions } from "./agenda-speaker-sessions";
import "../ui/ButtonToggle.css";
import { useEffect, useRef } from "preact/hooks";
import "../../design/tokens.agenda.generated.css";
import { formatTimeRangeInZone } from "../../shared/format-date";
import { agendaZoneAbbreviation } from "../../shared/agenda-time-display";
import type { ComponentChildren } from "preact";
import "./ContentAgenda.css";
import "./AgendaPrint.css";
import { LocalTime } from "./SiteDate";
import { Button } from "../ui/Button";
import { AgendaDayLabel } from "./AgendaDayLabel";
import { AgendaTimeChoice } from "./AgendaTimeChoice";
import { IconChevron, IconClock } from "../ui/MediaIcons";
import { AgendaSession, type AgendaSessionEditor } from "./AgendaSession";
import type { AgendaPersonalSession } from "./AgendaParticipationControls";
import { AgendaSpeaker } from "./AgendaSpeaker";
import { DeferredImages } from "./SiteImage";
import { AgendaToolbar } from "./AgendaToolbar";
import { agendaRows } from "./agenda-layout";
import { agendaFragmentRegistry } from "./agenda-fragments";
import { legacyAgendaFragmentMatchesPlacement } from "../../shared/legacy-agenda-fragments";
import type {
  ContentAgendaDay,
  ContentAgendaLocation,
  ContentAgendaSpeaker,
  ContentAgendaSpeakerFragment,
} from "../../shared/site-agenda";
// After every agenda part so the v4 presentation layer wins equal-specificity rules.
import "./AgendaDesign.css";

export function ContentAgenda({
  days,
  speakers,
  timeZone,
  editor,
  fragmentNavigation = false,
  legacySpeakerFragments = [],
  personal,
  openOccurrence,
}: {
  days: ContentAgendaDay[];
  speakers: ContentAgendaSpeaker[];
  timeZone: string;
  /** Only public pages own the URL fragment; portal views use their hash router. */
  fragmentNavigation?: boolean;
  legacySpeakerFragments?: readonly ContentAgendaSpeakerFragment[];
  /** Portal-only: the signed-in viewer's marks, the My agenda filter, and extra toolbar actions. */
  personal?: {
    session: (id: string) => AgendaPersonalSession | undefined;
    toolbarControls?: ComponentChildren;
    /** Opens with the My agenda filter on; the reader can still turn it off in place. */
    mineFilter?: boolean;
  };
  /** Portal-only: open this occurrence's details (the portal hash router owns the deep link). */
  openOccurrence?: string;
  editor?: {
    toolbarControls?: ComponentChildren;
    sidebar?: ComponentChildren;
    roomHeader?: (location: ContentAgendaLocation) => ComponentChildren;
    addLocation?: ComponentChildren;
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
  useEffect(() => {
    // Marks change in place, so an active My agenda filter must re-evaluate the cards.
    if (!personal) return;
    void import("./agenda-filters").then(({ refreshAgendaFilters }) => {
      if (root.current) refreshAgendaFilters(root.current);
    });
  });
  // A refreshed programme can move the session to another slot or room, which remounts its dialog.
  // Only such a move reopens it; an unchanged refresh must not reopen a dialog the reader closed.
  const openPlacement = openOccurrence
    ? days
        .flatMap((day) =>
          day.slots.flatMap((slot) =>
            slot.sessions
              .filter((session) => session.id === openOccurrence)
              .map((session) => `${day.date}|${slot.startsAt}|${session.endsAt ?? ""}|${session.locations.join(",")}`),
          ),
        )
        .join(";")
    : "";
  useEffect(() => {
    if (!openOccurrence) return;
    let active = true;
    void import("./agenda").then(({ openContentAgendaOccurrence }) => {
      if (active && root.current) openContentAgendaOccurrence(root.current, openOccurrence);
    });
    return () => {
      active = false;
    };
  }, [openOccurrence, openPlacement]);
  if (!days.length) return null;
  const venueLabel = timeZone.split("/").slice(1).join(" / ").replaceAll("_", " ") || timeZone;
  const speakerSessions = agendaSpeakerSessions(days);
  const fragments = agendaFragmentRegistry(days, legacySpeakerFragments, editor ? 80 : 0);
  const personalSession = (session: ContentAgendaDay["slots"][number]["sessions"][number]) =>
    !editor && personal && session.id && session.participation ? personal.session(session.id) : undefined;
  const mineCount = new Set(
    days.flatMap((day) =>
      day.slots.flatMap((slot) =>
        slot.sessions.flatMap((session) => {
          const marks = personalSession(session);
          return marks && (marks.starred || marks.status) ? [session.id] : [];
        }),
      ),
    ),
  ).size;
  return (
    <section
      ref={root}
      class="pk-content-agenda"
      aria-label="Event agenda"
      data-module="site/agenda"
      data-agenda-time-zone={timeZone}
      data-agenda-time-display="venue"
      data-agenda-public-fragments={fragmentNavigation && !editor ? "" : undefined}
      data-agenda-today-focus={editor || openOccurrence ? undefined : ""}
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
              <AgendaDayLabel date={day.date} />
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
            <small>All days</small>
          </button>
        </div>
      )}
      <AgendaToolbar
        days={days}
        editor={Boolean(editor)}
        editorControls={editor?.toolbarControls}
        personal={personal && { toolbarControls: personal.toolbarControls, mineFilter: personal.mineFilter, mineCount }}
      />
      <AgendaCalendarBody editor={Boolean(editor)} sidebar={editor?.sidebar}>
        {days.map((day) => (
          <section
            class="pk-content-agenda__day"
            id={`agenda-day-${day.date}`}
            role="tabpanel"
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
            {Boolean(day.staffing?.length) && (
              <div class="pk-content-agenda__staffing" aria-label="Shift hosts and question support">
                {day.staffing!.map((shift) => (
                  <section class="pk-content-agenda__staffing-shift" key={shift.id}>
                    <strong>{shift.name}</strong>
                    <small>
                      {formatTimeRangeInZone(shift.startAt, shift.endAt, timeZone)}
                      {shift.locationId
                        ? ` · ${day.locations.find((room) => room.id === shift.locationId)?.label ?? ""}`
                        : ""}
                      {shift.track ? ` · Track: ${shift.track}` : ""}
                    </small>
                    <ul>
                      {shift.duties.map((duty) => (
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
            {!editor && (
              <div class="pk-content-agenda__zone-key">
                <span title={timeZone}>Event time · {venueLabel}</span>
                <span data-agenda-browser-zone hidden>
                  Your time
                </span>
              </div>
            )}
            {!editor && (
              <div class="pk-content-agenda__earlier" data-agenda-earlier hidden>
                <Button variant="secondary" data-agenda-earlier-toggle aria-expanded="false">
                  <span data-agenda-earlier-label>Earlier today</span>
                  <IconChevron pointing="down" />
                </Button>
              </div>
            )}
            <table
              class="pk-content-agenda__timeline"
              data-agenda-has-rooms={day.locations.length ? "true" : "false"}
              data-agenda-filter-columns={editor ? undefined : ""}
            >
              <caption class="pk-sr-only">
                Agenda for {day.date}, times in {timeZone}
              </caption>
              <colgroup>
                <col class="pk-content-agenda__time-column" />
                {day.locations.map((location) => (
                  <col key={location.id} class="pk-content-agenda__room-column" data-agenda-column-room={location.id} />
                ))}
                {!day.locations.length && <col class="pk-content-agenda__room-column" />}
                {(editor?.addLocation || (editor && !day.locations.length)) && (
                  <col class="pk-content-agenda__add-column" />
                )}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" class="pk-content-agenda__time-heading">
                    <span class="pk-sr-only">Time</span>
                    <AgendaTimeChoice timeZone={timeZone} referenceDate={day.date} />
                    <div class="pk-content-agenda__zone-headings">
                      <small title={timeZone} data-agenda-zone-heading="venue">
                        <span>Time</span> <span>{venueLabel}</span>
                      </small>
                      <small data-agenda-browser-zone data-agenda-zone-heading="browser" hidden>
                        Your time
                      </small>
                    </div>
                  </th>
                  {day.locations.map((location, index) => (
                    <th
                      scope="col"
                      key={location.id}
                      class={`pk-content-agenda__location pk-content-agenda__location--${index % 7}`}
                      data-agenda-column-room={location.id}
                    >
                      {editor?.roomHeader ? editor.roomHeader(location) : location.label}
                    </th>
                  ))}
                  {!day.locations.length && (
                    <th scope="col" class="pk-content-agenda__location">
                      Sessions
                    </th>
                  )}
                  {(editor?.addLocation || (editor && !day.locations.length)) && (
                    <th scope="col" class="pk-agenda-editor__add-room">
                      {editor?.addLocation}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {agendaRows(day, 0, Boolean(editor)).map(({ slot, cells, ...row }, slotIndex) => (
                  <tr
                    class="pk-content-agenda__slot"
                    data-agenda-height={row.height}
                    data-agenda-compact-break={row.compactBreak ? "" : undefined}
                    data-agenda-room-change={roomChangeMinutes(day, slotIndex) ? "" : undefined}
                    data-agenda-break-interior={row.breakInterior ? "" : undefined}
                    data-agenda-start={editor ? slot.startsAt : undefined}
                    data-agenda-end={editor ? day.slots[slotIndex + 1]?.startsAt : undefined}
                    data-agenda-major={
                      editor &&
                      !row.breakInterior &&
                      (slotIndex === 0 ||
                        slotIndex === day.slots.length - 1 ||
                        Number(slot.time.slice(3, 5)) % 30 === 0)
                        ? ""
                        : undefined
                    }
                    key={`${slot.time}-${slotIndex}`}
                  >
                    <th scope="row" class="pk-content-agenda__time" aria-label={editor ? slot.time : undefined}>
                      {roomChangeMinutes(day, slotIndex) ? (
                        <span
                          class="pk-content-agenda__room-change"
                          title={`${roomChangeMinutes(day, slotIndex)} minutes to change rooms`}
                        >
                          <span aria-hidden="true">⇄</span> {roomChangeMinutes(day, slotIndex)} min
                        </span>
                      ) : null}
                      <div
                        class={`pk-content-agenda__clocks${row.breakInterior || (editor && slotIndex > 0 && slotIndex < day.slots.length - 1 && Number(slot.time.slice(3, 5)) % 30 !== 0) ? " pk-sr-only" : ""}`}
                      >
                        <div class="pk-content-agenda__clock" aria-label="Event time" data-agenda-clock="venue">
                          <time dateTime={slot.startsAt}>{slot.time}</time>
                          <small data-agenda-zone-abbr>{agendaZoneAbbreviation(slot.startsAt, timeZone)}</small>
                        </div>
                        <div
                          class="pk-content-agenda__clock"
                          aria-label="Your time"
                          data-agenda-clock="browser"
                          data-local-time-container
                          data-event-time-zone={timeZone}
                          hidden
                        >
                          <LocalTime value={slot.startsAt} format="time" />
                          <small data-agenda-local-date hidden />
                          <small data-agenda-zone-abbr />
                        </div>
                      </div>
                      {editor?.dropTarget(slot.startsAt, "")}
                    </th>
                    {slot.sessions.length ||
                    (editor && !slot.title && !slot.durationMinutes) ||
                    cells.some((cell) => cell === null) ? (
                      cells.map(
                        (cell, locationIndex) =>
                          cell && (
                            <td
                              class="pk-content-agenda__cell"
                              rowSpan={cell.rowSpan}
                              colSpan={cell.colSpan}
                              data-agenda-cell={day.locations[locationIndex]?.id}
                              data-agenda-column-start={locationIndex}
                              data-agenda-column-span={cell.colSpan}
                              key={locationIndex}
                            >
                              {editor?.dropTarget(slot.startsAt, day.locations[locationIndex]?.id ?? "")}
                              {cell.sessions.map((session, sessionIndex) => (
                                <AgendaSession
                                  session={session}
                                  legacyFragments={(session.legacyFragments ?? []).filter(
                                    (fragment) =>
                                      (!day.locations.length
                                        ? legacyAgendaFragmentMatchesPlacement(
                                            fragment,
                                            session,
                                            undefined,
                                            locationIndex,
                                          )
                                        : day.locations
                                            .slice(locationIndex, locationIndex + cell.colSpan)
                                            .some((location, offset) =>
                                              legacyAgendaFragmentMatchesPlacement(
                                                fragment,
                                                session,
                                                location.id,
                                                locationIndex + offset,
                                              ),
                                            )) && fragments.takeAlias(fragment.anchor),
                                  )}
                                  publicAnchor={
                                    !day.locations.length ||
                                    day.locations.slice(locationIndex, locationIndex + cell.colSpan).some(
                                      (_, offset) =>
                                        locationIndex + offset ===
                                        Math.max(
                                          0,
                                          day.locations.findIndex((location) => location.id === session.locations[0]),
                                        ),
                                    )
                                      ? fragments.takePrimary(session.publicAnchor)
                                      : undefined
                                  }
                                  editor={editor && session.id ? editor.session(session.id) : undefined}
                                  slot={slot}
                                  locations={day.locations}
                                  timeZone={timeZone}
                                  speakerSessions={speakerSessions}
                                  personal={personalSession(session)}
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
                        data-agenda-column-start="0"
                        data-agenda-column-span={Math.max(1, day.locations.length)}
                      >
                        {slot.title || slot.durationMinutes ? (
                          <div class="pk-content-agenda__break">
                            <strong>{slot.title}</strong>
                            {slot.durationMinutes ? (
                              <span>
                                <IconClock /> {slot.durationMinutes} min
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    )}
                    {(editor?.addLocation || (editor && !day.locations.length)) && (
                      <td class="pk-agenda-editor__add-room" />
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </AgendaCalendarBody>
      {!editor && (
        <section
          class="pk-content-agenda__speakers pk-agenda-speaker-directory"
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
          {/* A tab the reader opens: its portraits load when it is shown (deferred-images.ts). */}
          <DeferredImages>
            {speakers.map((speaker, index) => (
              <article key={index} class="pk-agenda-speaker-directory__entry">
                <AgendaSpeaker
                  speaker={speaker}
                  directory
                  profileId={`agenda-directory-speaker-${index}`}
                  sessions={speaker.speakerKey ? speakerSessions.get(speaker.speakerKey) : undefined}
                  timeZone={timeZone}
                />
              </article>
            ))}
          </DeferredImages>
        </section>
      )}
    </section>
  );
}

/**
 * Minutes between the last session ending before this slot and the slot's start, when
 * that changeover is short (≤ 15 min) and both sides are sessions rather than breaks.
 */
function roomChangeMinutes(day: ContentAgendaDay, slotIndex: number): number | undefined {
  const slot = day.slots[slotIndex];
  if (!slot || slotIndex === 0 || slot.title || !slot.sessions.some((session) => session.kind !== "break"))
    return undefined;
  const start = Date.parse(slot.startsAt);
  // Organizer grids add empty 5-minute rows, so look back across every earlier row.
  const earlier = day.slots.slice(0, slotIndex).flatMap((row) => row.sessions);
  if (
    earlier.some(
      (session) => session.kind === "break" && session.endsAt && Date.parse(session.endsAt) > start - 15 * 60_000,
    )
  )
    return undefined;
  const ends = earlier
    .filter((session) => session.kind !== "break" && session.endsAt)
    .map((session) => Date.parse(session.endsAt!))
    .filter((end) => end <= start);
  if (!ends.length) return undefined;
  const minutes = Math.round((start - Math.max(...ends)) / 60_000);
  return minutes > 0 && minutes <= 15 ? minutes : undefined;
}

/** Editor sources share the calendar body; public pages retain their original markup. */
function AgendaCalendarBody({
  editor,
  sidebar,
  children,
}: {
  editor: boolean;
  sidebar?: ComponentChildren;
  children: ComponentChildren;
}) {
  return editor ? (
    <div class="pk-agenda-editor__canvas">
      {children}
      {sidebar}
    </div>
  ) : (
    <>{children}</>
  );
}
