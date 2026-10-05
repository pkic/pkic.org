import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import type { RowActionsProps } from "../../../../../../ui/RowActions";
import type { useAgendaScheduling } from "./useAgendaScheduling";

interface AgendaSessionActionContext {
  canEdit: boolean;
  canReviewAppearances: boolean;
  busy: boolean;
  scheduling: Pick<ReturnType<typeof useAgendaScheduling>, "actions" | "move" | "resize" | "timeStep">;
  open: Record<
    "duplicate" | "history" | "promotion" | "participation" | "move" | "swap" | "edit",
    (session: AgendaOccurrence) => void
  >;
  select: (id: string, kind: "move" | "resize") => void;
}

/** Cards, rows and details offer the same authorized commands for the same occurrence. */
export function agendaSessionActions(
  occurrence: AgendaOccurrence,
  { canEdit, canReviewAppearances, busy, scheduling, open, select }: AgendaSessionActionContext,
  beforeSelect?: () => void,
): RowActionsProps["actions"] {
  const actions: RowActionsProps["actions"] = !canEdit
    ? canReviewAppearances
      ? [{ id: "history", label: "Review historical representation", onSelect: () => open.history(occurrence) }]
      : []
    : [
        ...scheduling.actions(occurrence),
        { id: "duplicate", label: "Duplicate session", disabled: busy, onSelect: () => open.duplicate(occurrence) },
        { id: "history", label: "Session archive / materials", onSelect: () => open.history(occurrence) },
        { id: "promotion", label: "Speaker promotion kit", onSelect: () => open.promotion(occurrence) },
        { id: "participation", label: "Participation / approvals", onSelect: () => open.participation(occurrence) },
        {
          id: "resize",
          label: "Select end time to resize",
          disabled: !occurrence.startAt || busy,
          onSelect: () => select(occurrence.id, "resize"),
        },
        { id: "move", label: "Move to day / location", disabled: busy, onSelect: () => open.move(occurrence) },
        { id: "select", label: "Select for move", disabled: busy, onSelect: () => select(occurrence.id, "move") },
        {
          id: "swap",
          label: "Swap sessions",
          disabled: !occurrence.startAt || busy,
          onSelect: () => open.swap(occurrence),
        },
        {
          id: "extend",
          label: `Extend by ${scheduling.timeStep} minutes`,
          disabled: !occurrence.endAt || busy,
          onSelect: () =>
            occurrence.endAt &&
            scheduling.resize(
              occurrence.id,
              new Date(Date.parse(occurrence.endAt) + scheduling.timeStep * 60000).toISOString(),
              occurrence.roomId ?? "",
            ),
        },
        { id: "edit", label: "Edit / move session", onSelect: () => open.edit(occurrence) },
        ...([-1, 1] as const).map((direction) => ({
          id: direction === -1 ? "earlier" : "later",
          label: `Move ${direction === -1 ? "earlier" : "later"} · ${scheduling.timeStep} minutes`,
          disabled: !occurrence.startAt || busy,
          onSelect: () =>
            occurrence.startAt &&
            scheduling.move(
              occurrence.id,
              new Date(Date.parse(occurrence.startAt) + direction * scheduling.timeStep * 60000).toISOString(),
              occurrence.roomId,
            ),
        })),
      ];
  return beforeSelect
    ? actions.map((action) => ({
        ...action,
        onSelect: () => {
          beforeSelect();
          action.onSelect?.();
        },
      }))
    : actions;
}
