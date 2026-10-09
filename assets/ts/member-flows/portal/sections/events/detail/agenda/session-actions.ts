import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import type { RowActionsProps } from "../../../../../../ui/RowActions";
import type { useAgendaScheduling } from "./useAgendaScheduling";

interface AgendaSessionActionContext {
  canEdit: boolean;
  canInspect?: boolean;
  canReviewAppearances: boolean;
  busy: boolean;
  scheduling: Pick<ReturnType<typeof useAgendaScheduling>, "actions" | "move" | "resize" | "timeStep">;
  open: Record<
    "duplicate" | "history" | "promotion" | "participation" | "move" | "swap" | "edit",
    (session: AgendaOccurrence) => void
  > & { locations?: (session: AgendaOccurrence) => void };
  select: (id: string, kind: "move" | "resize") => void;
  /** Calendar selection needs calendar editing; a locked calendar would silently ignore it. */
  selectionLocked?: boolean;
}

/** Direct card interactions replace selection commands; table bulk selection stays available. */
export function agendaCardActions(actions: RowActionsProps["actions"]) {
  return actions.filter((action) => !["resize", "select", "bulk"].includes(action.id));
}

/** Cards, rows and details offer the same authorized commands for the same occurrence. */
export function agendaSessionActions(
  occurrence: AgendaOccurrence,
  {
    canEdit,
    canInspect,
    canReviewAppearances,
    busy,
    scheduling,
    open,
    select,
    selectionLocked = false,
  }: AgendaSessionActionContext,
  beforeSelect?: () => void,
): RowActionsProps["actions"] {
  const schedulingActions = canEdit ? scheduling.actions(occurrence) : [];
  const actions: RowActionsProps["actions"] = !canEdit
    ? canInspect
      ? [
          { id: "history", label: "Session archive / materials", onSelect: () => open.history(occurrence) },
          { id: "promotion", label: "Speaker promotion kit", onSelect: () => open.promotion(occurrence) },
        ]
      : canReviewAppearances
        ? [{ id: "history", label: "Review historical representation", onSelect: () => open.history(occurrence) }]
        : []
    : [
        // The record itself.
        { id: "edit", label: "Edit session", disabled: busy, onSelect: () => open.edit(occurrence) },
        { id: "duplicate", label: "Duplicate session", disabled: busy, onSelect: () => open.duplicate(occurrence) },
        // Where and when it runs.
        {
          id: "move",
          label: "Move to day / location",
          disabled: busy,
          separatorBefore: true,
          onSelect: () => open.move(occurrence),
        },
        ...(open.locations
          ? [
              {
                id: "locations",
                label: "Change locations…",
                disabled: busy,
                onSelect: () => open.locations?.(occurrence),
              },
            ]
          : []),
        {
          id: "swap",
          label: "Swap sessions",
          disabled: !occurrence.startAt || busy,
          onSelect: () => open.swap(occurrence),
        },
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
        ...schedulingActions.filter((action) => action.id !== "bulk"),
        // Calendar and table selection; cards and details drop these in favour of direct manipulation.
        {
          id: "select",
          label: "Select for move",
          disabled: busy || selectionLocked,
          separatorBefore: true,
          onSelect: () => select(occurrence.id, "move"),
        },
        {
          id: "resize",
          label: "Select end time to resize",
          disabled: !occurrence.startAt || busy || selectionLocked,
          onSelect: () => select(occurrence.id, "resize"),
        },
        ...schedulingActions.filter((action) => action.id === "bulk"),
        // Related workspaces for this session.
        {
          id: "history",
          label: "Session archive / materials",
          separatorBefore: true,
          onSelect: () => open.history(occurrence),
        },
        { id: "promotion", label: "Speaker promotion kit", onSelect: () => open.promotion(occurrence) },
        { id: "participation", label: "Participation / approvals", onSelect: () => open.participation(occurrence) },
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
