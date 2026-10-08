import { registrationSessionsResponseSchema } from "../../../../../../../shared/schemas/event-registration-sessions";
import { sessionParticipationStatusSchema } from "../../../../../../../shared/schemas/event-participation-scanning";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { statusLabel } from "../../../../../../../shared/status-display";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Badge } from "../../../../../../components/Badge";
import { PreferenceStar } from "../../../../../../ui/PreferenceStar";
import { eventRegistrationPath } from "../registration-paths";

/** The selected registration determines the owner on the server. */
export function AttendeeSessions({ slug, registrationId }: { slug: string; registrationId: string }) {
  return (
    <ApiDataTable
      endpoint={`${eventRegistrationPath(slug, registrationId)}/sessions`}
      responseSchema={registrationSessionsResponseSchema}
      resolve={(value) => value.sessions}
      resolvePage={(value) => value.page}
      caption="Attendee sessions"
      inset={<p class="pk-muted pk-small">Favorites show interest; reservations do not confirm attendance.</p>}
      rowKey={(row) => row.id}
      paginate
      initialSort="startAt"
      urlState={`attendee-sessions-${registrationId}`}
      clearDataOnReload
      retainDataOnError={false}
      searchPlaceholder="Search sessions…"
      empty="No preferences or reservations in the published agenda."
      columns={[
        { header: "Session", cell: (row) => row.title, sort: { asc: "title", desc: "-title" }, hideable: false },
        {
          header: "Scheduled time",
          cell: (row) => (row.startAt ? formatDateTimeInZone(row.startAt, row.timeZone) : "Time not recorded"),
          sort: { asc: "startAt", desc: "-startAt" },
        },
        {
          header: "Favorite",
          cell: (row) => (
            <span role="img" aria-label={row.saved ? "Saved" : "Not saved"} title={row.saved ? "Saved" : "Not saved"}>
              <PreferenceStar selected={row.saved} />
            </span>
          ),
          filter: {
            param: "saved",
            options: [
              { value: "", label: "All preferences" },
              { value: "true", label: "Saved" },
              { value: "false", label: "Not saved" },
            ],
          },
        },
        {
          header: "Participation",
          cell: (row) => <Badge status={row.status} />,
          filter: {
            param: "status",
            options: [
              { value: "", label: "All participation states" },
              ...sessionParticipationStatusSchema.options.map((value) => ({ value, label: statusLabel(value) })),
            ],
          },
        },
        {
          header: "Attendance mode",
          cell: (row) =>
            row.attendanceMode === "remote"
              ? "Remote"
              : row.attendanceMode === "physical"
                ? "In person"
                : "Not selected",
        },
        {
          header: "Selected location",
          cell: (row) =>
            row.roomId
              ? (row.rooms.find((room) => room.id === row.roomId)?.name ?? "Location not available")
              : "Not selected",
        },
      ]}
    />
  );
}
