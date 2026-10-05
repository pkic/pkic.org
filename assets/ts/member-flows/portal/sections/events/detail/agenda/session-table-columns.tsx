import { publicSessionTiming } from "../../../../../../../shared/session-public-timing";
import { publicSessionCredits } from "../../../../../../../shared/session-public-credits";
import { formatNumber } from "../../../../../../../shared/format-number";
import type { z } from "zod";
import { Badge } from "../../../../../../ui/Badge";
import { agendaOccurrenceRoomIds } from "../../../../../../../shared/event-agenda-rooms";
import type { ColumnFilter, DataTableProps } from "../../../../../../components/Table";
import { RowActions, type RowActionsProps } from "../../../../../../ui/RowActions";
import {
  agendaOccurrenceListItemSchema,
  agendaConflictCategorySchema,
  agendaOccurrenceQuerySchema,
  agendaAdmissionPolicySchema,
  agendaVisibilitySchema,
  agendaSessionKindSchema,
  agendaAccessPolicySchema,
  agendaPublicationStatusSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { formatCalendarDate, formatTimeRangeInZone } from "../../../../../../../shared/format-date";
const conflictLabels: Record<z.infer<typeof agendaConflictCategorySchema>, string> = {
  room_overlap: "location overlap",
  room_setup: "location setup time",
  room_unavailable: "location unavailable",
  speaker_conflict: "speaker overlap or travel time",
  speaker_duty_conflict: "speaker duty overlap or travel time",
  speaker_meeting_conflict: "speaker meeting overlap or travel time",
};
export function agendaSessionColumns(
  data: AgendaSnapshot,
  days: Array<{ date: string }>,
  canEdit: boolean,
  actions: (row: AgendaOccurrence) => RowActionsProps["actions"],
  speakerFilter: ColumnFilter = { param: "speakerUserId", options: [{ value: "", label: "All speakers" }] },
): DataTableProps<z.infer<typeof agendaOccurrenceListItemSchema>>["columns"] {
  return [
    {
      header: "Session",
      width: "primary",
      cell: (row) => row.title,
      sort: { asc: "title", desc: "-title" },
      hideable: false,
    },
    {
      header: "Day",
      width: "fit",
      cell: (row) => {
        const timing = publicSessionTiming(row);
        return timing
          ? formatCalendarDate(instantToDateTimeLocal(timing.startAt, data.timeZone).slice(0, 10))
          : "Unscheduled";
      },
      filter: {
        param: "day",
        options: [
          { value: "", label: "All days" },
          ...days.map((day) => ({ value: day.date, label: formatCalendarDate(day.date) })),
        ],
      },
    },
    {
      header: "Time",
      cell: (row) => {
        const timing = publicSessionTiming(row);
        return timing ? (
          <span>
            {formatTimeRangeInZone(timing.startAt, timing.endAt, data.timeZone)}
            {timing.endNotRecorded && <> · End not recorded</>}
          </span>
        ) : (
          "Unscheduled"
        );
      },
      sort: { asc: "startAt", desc: "-startAt" },
    },
    {
      header: "Location",
      cell: (row) =>
        agendaOccurrenceRoomIds(row)
          .map((id) => data.rooms.find((room) => room.id === id)?.name)
          .filter(Boolean)
          .join(" / ") || "Unassigned",
      filter: {
        param: "roomId",
        options: [
          { value: "", label: "All locations" },
          ...data.rooms.map((room) => ({ value: room.id, label: room.name })),
        ],
      },
    },
    {
      header: "Admission",
      defaultHidden: true,
      cell: (row) => row.admissionPolicy,
      filter: {
        param: "admissionPolicy",
        options: [
          { value: "", label: "All policies" },
          ...agendaAdmissionPolicySchema.options.map((value) => ({ value, label: value })),
        ],
      },
    },
    {
      header: "Visibility",
      defaultHidden: true,
      cell: (row) => row.visibility,
      filter: {
        param: "visibility",
        options: [
          { value: "", label: "All visibility" },
          ...agendaVisibilitySchema.options.map((value) => ({ value, label: value })),
        ],
      },
    },
    {
      header: "Type",
      defaultHidden: true,
      cell: (row) => row.kind,
      filter: {
        param: "kind",
        options: [
          { value: "", label: "All types" },
          ...agendaSessionKindSchema.options.map((value) => ({ value, label: value })),
        ],
      },
    },
    {
      header: "Speakers",
      defaultHidden: true,
      cell: (row) =>
        publicSessionCredits(row)
          .map((credit) => credit.displayName)
          .join(", ") || "—",
      filter: speakerFilter,
    },
    {
      header: "Track",
      defaultHidden: true,
      cell: (row) => row.track || "—",
      filter: { param: "track", text: { placeholder: "Track name", hint: "Matches the exact session track." } },
    },
    ...(["confirmed", "pending", "waitlisted"] as const).map((status) => ({
      header: status === "confirmed" ? "Confirmed" : status === "pending" ? "Pending" : "Waitlisted",
      align: "end" as const,
      width: "fit" as const,
      defaultHidden: status !== "confirmed",
      cell: (row: z.infer<typeof agendaOccurrenceListItemSchema>) => (
        <div>
          <div>In person: {formatNumber(row.demand.physical[status])}</div>
          <div>Remote: {formatNumber(row.demand.remote[status])}</div>
        </div>
      ),
    })),
    {
      header: "Access",
      defaultHidden: true,
      cell: (row) => (row.accessPolicy === "invitation" ? "Invitation only" : "Open"),
      filter: {
        param: "accessPolicy",
        options: [
          { value: "", label: "All access" },
          ...agendaAccessPolicySchema.options.map((value) => ({
            value,
            label: value === "invitation" ? "Invitation only" : "Open",
          })),
        ],
      },
    },
    {
      header: "Publication",
      defaultHidden: true,
      cell: (row) =>
        row.publicationStatus === "published"
          ? "Approved"
          : row.publicationStatus === "changed"
            ? "Unpublished changes"
            : "Not approved",
      filter: {
        param: "publicationStatus",
        options: [
          { value: "", label: "All publication states" },
          ...agendaPublicationStatusSchema.options.map((value) => ({
            value,
            label: value === "published" ? "Approved" : value === "changed" ? "Unpublished changes" : "Not approved",
          })),
        ],
      },
    },
    {
      header: "Conflicts",
      width: "fit",
      cell: (row) => {
        const coverage = row.conflicts.coverage;
        const incomplete = coverage !== "complete";
        const label = row.conflicts.hasConflict
          ? `Needs attention: ${row.conflicts.categories.map((category) => conflictLabels[category]).join(", ")}${incomplete ? ". Conflict checks are incomplete." : ""}`
          : coverage === "incomplete"
            ? "Conflict checks are incomplete; review unresolved source credits."
            : coverage === "not_scheduled"
              ? "Conflict checks require a complete scheduled interval."
              : "No scheduling conflicts";
        return (
          <Badge
            tone={row.conflicts.hasConflict || coverage === "incomplete" ? "warn" : incomplete ? "neutral" : "ok"}
            label={label}
          >
            {row.conflicts.hasConflict
              ? "Needs attention"
              : coverage === "incomplete"
                ? "Needs review"
                : coverage === "not_scheduled"
                  ? "Not checked"
                  : "Clear"}
          </Badge>
        );
      },
      filter: {
        param: "conflict",
        options: [
          { value: "", label: "All sessions" },
          ...agendaOccurrenceQuerySchema.shape.conflict
            .unwrap()
            .options.filter((value) => value !== "all")
            .map((value) => ({
              value,
              label:
                value === "conflicted"
                  ? "Needs attention"
                  : value === "incomplete"
                    ? "Checks incomplete"
                    : "No conflicts",
            })),
        ],
      },
    },
    {
      header: "Actions",
      width: "fit",
      cell: (row) => (canEdit ? <RowActions subject={row.title} actions={actions(row)} /> : null),
      hideable: false,
    },
  ];
}
