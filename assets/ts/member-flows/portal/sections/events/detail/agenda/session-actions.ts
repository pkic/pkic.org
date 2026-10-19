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

/** What a session's related workspaces are called wherever they are offered. */
const MATERIALS_LABEL = "Materials and archive";
const PROMOTION_LABEL = "Speaker promotion kit";

/**
 * Cards, rows and details offer the same authorized commands for the same occurrence, in groups: the record,
 * where and when it runs, small timing changes, selection, and related workspaces. An ellipsis marks the
 * commands that open a dialog for more input.
 */
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
  const schedulingAction = (id: string) => schedulingActions.filter((action) => action.id === id);
  const step = scheduling.timeStep;
  const actions: RowActionsProps["actions"] = !canEdit
    ? canInspect
      ? [
          { id: "history", label: MATERIALS_LABEL, onSelect: () => open.history(occurrence) },
          { id: "promotion", label: PROMOTION_LABEL, onSelect: () => open.promotion(occurrence) },
        ]
      : canReviewAppearances
        ? [{ id: "history", label: "Review historical representation", onSelect: () => open.history(occurrence) }]
        : []
    : [
        // The record itself.
        { id: "edit", label: "Edit session…", disabled: busy, onSelect: () => open.edit(occurrence) },
        { id: "duplicate", label: "Duplicate session…", disabled: busy, onSelect: () => open.duplicate(occurrence) },
        // Where and when it runs.
        {
          id: "move",
          label: "Move to another day or location…",
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
          label: "Swap with another session…",
          disabled: !occurrence.startAt || busy,
          onSelect: () => open.swap(occurrence),
        },
        ...schedulingAction("unschedule"),
        // Small timing changes: the start time by the planner's step, or the place in the running order.
        ...([-1, 1] as const).map((direction, index) => ({
          id: direction === -1 ? "earlier" : "later",
          label: `Start ${step} minutes ${direction === -1 ? "earlier" : "later"}`,
          disabled: !occurrence.startAt || busy,
          separatorBefore: index === 0,
          onSelect: () =>
            occurrence.startAt &&
            scheduling.move(
              occurrence.id,
              new Date(Date.parse(occurrence.startAt) + direction * step * 60000).toISOString(),
              occurrence.roomId,
            ),
        })),
        {
          id: "extend",
          label: `Extend by ${step} minutes`,
          disabled: !occurrence.endAt || busy,
          onSelect: () =>
            occurrence.endAt &&
            scheduling.resize(
              occurrence.id,
              new Date(Date.parse(occurrence.endAt) + step * 60000).toISOString(),
              occurrence.roomId ?? "",
            ),
        },
        ...schedulingAction("up"),
        ...schedulingAction("down"),
        // Calendar and table selection; cards and details drop these in favor of direct manipulation.
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
        ...schedulingAction("bulk"),
        // Related workspaces for this session.
        {
          id: "history",
          label: MATERIALS_LABEL,
          separatorBefore: true,
          onSelect: () => open.history(occurrence),
        },
        { id: "promotion", label: PROMOTION_LABEL, onSelect: () => open.promotion(occurrence) },
        {
          id: "participation",
          label: "Participation and approvals",
          onSelect: () => open.participation(occurrence),
        },
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
