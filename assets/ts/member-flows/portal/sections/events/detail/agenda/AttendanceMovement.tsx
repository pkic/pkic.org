/**
 * Where people actually were. By session: in-person check-ins and the people
 * attributed to each session, where a stay counts only when it covers the
 * event's minimum share of the session, and a person checked in to sessions
 * that overlap counts only in the one they stayed in longest. By person: the
 * sessions each person moved through, in order, with the time spent in each.
 * The server attributes; this view only renders its results.
 */
import type { ClockZone } from "../../../../../../../shared/event-clock";
import { formatClockRangeInZone, formatDateTimeInZone, formatDuration } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import {
  attendanceAttributionsResponseSchema,
  attendanceMovementsResponseSchema,
  type AttendanceMovement as Movement,
} from "../../../../../../../shared/schemas/event-attendance-movement";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Tabs } from "../../../../../../ui/Tabs";
import { attendancePath } from "./attendance-navigation";
import { formatMinimumStay } from "./attendance-movement-copy";
import { useState } from "preact/hooks";
import "./AttendanceMovement.css";

const count = (value: number) => formatNumber(value);
const number = { align: "end", width: "fit" } as const;

export function AttendanceMovement({
  slug,
  timeZone,
  basePath,
  view,
}: {
  slug: string;
  timeZone: ClockZone;
  basePath: string;
  view: "sessions" | "people";
}) {
  return (
    <div class="pk-stack">
      <Tabs
        label="Movement sections"
        activeId={view}
        items={[
          { id: "sessions", label: "By session", href: attendancePath(basePath, "movement") },
          { id: "people", label: "By person", href: attendancePath(basePath, "movement", "people") },
        ]}
      />
      {view === "people" ? (
        <PeopleMovement slug={slug} timeZone={timeZone} />
      ) : (
        <SessionAttributions slug={slug} timeZone={timeZone} />
      )}
    </div>
  );
}

function SessionAttributions({ slug, timeZone }: { slug: string; timeZone: ClockZone }) {
  const [minimumStay, setMinimumStay] = useState<number | null>(null);
  return (
    <ApiDataTable
      urlState="attendance-attributions"
      clearDataOnReload
      retainDataOnError={false}
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance/attributions`}
      responseSchema={attendanceAttributionsResponseSchema}
      resolve={(data) => data.sessions}
      resolvePage={(data) => data.page}
      caption="Attributed attendance by session"
      rowKey={(row) => row.session.id}
      paginate
      searchPlaceholder="Search sessions or rooms…"
      onData={(data) => setMinimumStay(data.minimumStayPercent)}
      inset={
        <p class="pk-muted">
          A stay counts toward a session when it covers at least {formatMinimumStay(minimumStay)}. Someone who checked
          in to sessions that overlap counts only in the one they stayed in longest. Time in a session runs from their
          check-in to their next check-in elsewhere, their check-out or the session's end.
        </p>
      }
      columns={[
        {
          header: "Session",
          cell: (row) => row.session.title,
          sort: { asc: "title", desc: "-title" },
          hideable: false,
        },
        {
          header: "Time",
          cell: (row) => formatClockRangeInZone(row.session.startAt, row.session.endAt, timeZone),
          sort: { asc: "startAt", desc: "-startAt" },
          width: "fit",
        },
        { header: "Room", cell: (row) => row.session.room?.name ?? "" },
        {
          header: "Checked in",
          cell: (row) => count(row.checkedIn),
          sort: { asc: "checkedIn", desc: "-checkedIn" },
          ...number,
        },
        { header: "Attributed", cell: (row) => count(row.attributed), ...number },
        { header: "Not registered or booked", cell: (row) => count(row.unexpected), ...number },
        { header: "Online", cell: (row) => count(row.remote), ...number },
      ]}
    />
  );
}

function Stays({ person, timeZone }: { person: Movement; timeZone: ClockZone }) {
  return (
    <ol class="pk-attendance-stays">
      {person.stays.map((stay) => (
        <li key={stay.session.id} class="pk-attendance-stays__stay">
          <span class="pk-attendance-stays__session">{stay.session.title}</span>
          <span class="pk-muted">
            {formatClockRangeInZone(stay.checkedInAt, stay.leftAt, timeZone)},{" "}
            {formatDuration(stay.dwellSeconds * 1000)}
            {stay.attributed ? ", counted here" : stay.tooShort ? ", too short to count" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

function PeopleMovement({ slug, timeZone }: { slug: string; timeZone: ClockZone }) {
  const [minimumStay, setMinimumStay] = useState<number | null>(null);
  return (
    <ApiDataTable
      urlState="attendance-movements"
      clearDataOnReload
      retainDataOnError={false}
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance/movements`}
      responseSchema={attendanceMovementsResponseSchema}
      resolve={(data) => data.people}
      resolvePage={(data) => data.page}
      caption="In-person movement by person"
      rowKey={(row) => row.person.userId}
      paginate
      searchPlaceholder="Search people…"
      onData={(data) => setMinimumStay(data.minimumStayPercent)}
      inset={
        <p class="pk-muted">
          Each person's in-person session check-ins in order. "Counted here" marks the session they are attributed to
          when sessions overlap. "Too short to count" marks a stay that covers less than{" "}
          {formatMinimumStay(minimumStay)}.
        </p>
      }
      columns={[
        {
          header: "Person",
          cell: (row) => row.person.displayName ?? row.person.email ?? "Unnamed person",
          sort: { asc: "name", desc: "-name" },
          hideable: false,
        },
        {
          header: "First check-in",
          cell: (row) => formatDateTimeInZone(row.firstCheckInAt, timeZone),
          sort: { asc: "firstCheckInAt", desc: "-firstCheckInAt" },
          width: "fit",
        },
        { header: "Sessions", cell: (row) => <Stays person={row} timeZone={timeZone} /> },
      ]}
    />
  );
}
