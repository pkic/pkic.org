import { publicSessionTiming } from "../../../../../../../shared/session-public-timing";
import { publicSessionCredits } from "../../../../../../../shared/session-public-credits";
import { publicSessionMediaUrls } from "../../../../../../../shared/schemas/event-session-history";
import { formatNumber } from "../../../../../../../shared/format-number";
import type { z } from "zod";
import { IconBadge } from "../../../../../../ui/Badge";
import { IconVideo } from "../../../../../../ui/MediaIcons";
import { IconFlag, IconPeople, IconRemote } from "../../../../../../components/icons/indicators";
import { IconInfoCircle } from "../../../../../../components/icons";
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
import { contractClock } from "../../../../../../../shared/event-clock";
import {
  AGENDA_ACCESS_POLICY_LABELS,
  AGENDA_ADMISSION_POLICY_LABELS,
  AGENDA_SESSION_KIND_LABELS,
  AGENDA_VISIBILITY_LABELS,
} from "../../../../../../../shared/event-agenda-labels";

/** A cell with nothing to report: blank on screen, still said to a screen reader. */
function quietCell(spoken: string) {
  return <span class="pk-sr-only">{spoken}</span>;
}
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
            {formatTimeRangeInZone(timing.startAt, timing.endAt, contractClock(data))}
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
      cell: (row) => AGENDA_ADMISSION_POLICY_LABELS[row.admissionPolicy],
      filter: {
        param: "admissionPolicy",
        options: [
          { value: "", label: "All policies" },
          ...agendaAdmissionPolicySchema.options.map((value) => ({
            value,
            label: AGENDA_ADMISSION_POLICY_LABELS[value],
          })),
        ],
      },
    },
    {
      header: "Visibility",
      defaultHidden: true,
      cell: (row) => AGENDA_VISIBILITY_LABELS[row.visibility],
      filter: {
        param: "visibility",
        options: [
          { value: "", label: "All visibility" },
          ...agendaVisibilitySchema.options.map((value) => ({ value, label: AGENDA_VISIBILITY_LABELS[value] })),
        ],
      },
    },
    {
      header: "Type",
      defaultHidden: true,
      cell: (row) => AGENDA_SESSION_KIND_LABELS[row.kind],
      filter: {
        param: "kind",
        options: [
          { value: "", label: "All types" },
          ...agendaSessionKindSchema.options.map((value) => ({ value, label: AGENDA_SESSION_KIND_LABELS[value] })),
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
    // Text heads, not glyphs: a check mark over a column of counts did not
    // say "reserved" to anyone who had not hovered it.
    ...(["confirmed", "pending", "waitlisted"] as const).map((status) => {
      const noun =
        status === "confirmed"
          ? "reservations"
          : status === "pending"
            ? "reservations awaiting approval"
            : "waitlisted participants";
      return {
        header: status === "confirmed" ? "Reserved" : status === "pending" ? "Pending approval" : "Waitlisted",
        align: "end" as const,
        width: "fit" as const,
        defaultHidden: status !== "confirmed",
        cell: (row: z.infer<typeof agendaOccurrenceListItemSchema>) =>
          row.demand.physical[status] + row.demand.remote[status] === 0 ? (
            quietCell(`No ${noun}`)
          ) : (
            <div class="pk-cluster pk-cluster--end pk-cluster--nowrap">
              <IconBadge
                icon={<IconPeople />}
                label={`In-person ${noun}: ${formatNumber(row.demand.physical[status])}`}
                count={row.demand.physical[status]}
              />
              <IconBadge
                icon={<IconRemote />}
                label={`Remote ${noun}: ${formatNumber(row.demand.remote[status])}`}
                count={row.demand.remote[status]}
              />
            </div>
          ),
      };
    }),
    {
      header: "Access",
      defaultHidden: true,
      cell: (row) => AGENDA_ACCESS_POLICY_LABELS[row.accessPolicy ?? "open"],
      filter: {
        param: "accessPolicy",
        options: [
          { value: "", label: "All access" },
          ...agendaAccessPolicySchema.options.map((value) => ({ value, label: AGENDA_ACCESS_POLICY_LABELS[value] })),
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
      header: "Recording",
      width: "fit",
      defaultHidden: true,
      cell: (row) =>
        publicSessionMediaUrls(row.history?.materials ?? []).recordingUrl ? (
          <IconBadge icon={<IconVideo />} label="Approved recording available" tone="ok" />
        ) : (
          <IconBadge icon={<IconInfoCircle />} label="No approved recording available" />
        ),
    },
    {
      header: "Conflicts",
      width: "fit",
      // Only something to act on is colored. A clean session leaves the cell
      // blank rather than drawing a green check on every row.
      cell: (row) => {
        const coverage = row.conflicts.coverage;
        const incomplete = coverage !== "complete";
        if (row.conflicts.hasConflict) {
          return (
            <IconBadge
              tone="warn"
              label={`Needs attention: ${row.conflicts.categories.map((category) => conflictLabels[category]).join(", ")}${incomplete ? ". Conflict checks are incomplete." : ""}`}
              icon={<IconFlag />}
            />
          );
        }
        if (!incomplete) return quietCell("No scheduling conflicts");
        // Unresolved source credits can hide a real conflict, so they ask for
        // review; an unscheduled session simply has nothing to check yet.
        return coverage === "incomplete" ? (
          <IconBadge
            tone="warn"
            label="Conflict checks are incomplete; review unresolved source credits."
            icon={<IconFlag />}
          />
        ) : (
          <IconBadge label="Conflict checks require a complete scheduled interval." icon={<IconInfoCircle />} />
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
