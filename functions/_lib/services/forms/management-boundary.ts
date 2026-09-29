import type { FormPurpose } from "../../../../assets/shared/schemas/forms";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import type { FormPlacement } from "../../../../assets/shared/schemas/forms";

type FormMutationTarget = { id: string; scope_type: string; purpose: FormPurpose };

/**
 * Legacy administrator form routes may not mutate a group-owned form or an
 * event-flow definition/placement owned by a portal event. Those aggregates
 * have canonical group-scoped authorization and guarded lifecycle commands.
 */
export async function requireManagedFormMutationBoundary(db: DatabaseLike, form: FormMutationTarget): Promise<void> {
  if (form.scope_type === "community") {
    throw new AppError(
      403,
      "GROUP_FORM_MANAGEMENT_REQUIRED",
      "Group-owned forms must be changed from their owning group context.",
    );
  }
  if (form.purpose !== "event_registration" && form.purpose !== "proposal_submission") return;
  const portalPlacement = await first<{ id: string }>(
    db,
    `SELECT event.id
       FROM form_placements placement
       JOIN events event ON event.id = placement.context_ref
      WHERE placement.form_id = ?
        AND placement.context_type = 'event'
        AND event.source_mode = 'portal'
      LIMIT 1`,
    [form.id],
  );
  if (portalPlacement) {
    throw new AppError(
      403,
      "PORTAL_EVENT_FORM_MANAGEMENT_REQUIRED",
      "Portal event-flow forms must be changed from their owning group context.",
    );
  }
}

/** Rejects a known portal-event target before a global placement mutation reaches its D1 batch. */
export async function requireManagedFormPlacementTargetBoundary(
  db: DatabaseLike,
  form: Pick<FormMutationTarget, "purpose">,
  target: Pick<FormPlacement, "contextType" | "contextRef">,
): Promise<void> {
  if (
    (form.purpose !== "event_registration" && form.purpose !== "proposal_submission") ||
    target.contextType !== "event" ||
    !target.contextRef
  ) {
    return;
  }
  const portalEvent = await first<{ id: string }>(
    db,
    "SELECT id FROM events WHERE id = ? AND source_mode = 'portal' LIMIT 1",
    [target.contextRef],
  );
  if (portalEvent) {
    throw new AppError(
      403,
      "PORTAL_EVENT_FORM_MANAGEMENT_REQUIRED",
      "Portal event-flow forms must be changed from their owning group context.",
    );
  }
}

/** Global form management may target only installation-wide or event response sets. */
export function requireGlobalFormPlacementTargetBoundary(target: Pick<FormPlacement, "contextType">): void {
  if (target.contextType === "installation" || target.contextType === "event") return;
  throw new AppError(
    400,
    "FORM_PLACEMENT_CONTEXT_UNSUPPORTED",
    "Group and organization placements must be managed from their owning resource context.",
  );
}

/** Rechecks the target event inside the same D1 mutation batch to close the route-to-write race. */
export function prepareManagedFormPlacementTargetGuard(
  db: DatabaseLike,
  form: Pick<FormMutationTarget, "purpose">,
  target: Pick<FormPlacement, "contextType" | "contextRef">,
): StatementLike {
  if (form.purpose !== "event_registration" && form.purpose !== "proposal_submission") {
    return prepareAuthorizationGuard(db, { sql: "SELECT 1", bindings: [] });
  }
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            WHERE NOT EXISTS (
              SELECT 1
                FROM events event
               WHERE event.id = ?
                 AND ? = 'event'
                 AND event.source_mode = 'portal'
            )`,
    bindings: [target.contextRef, target.contextType],
  });
}
