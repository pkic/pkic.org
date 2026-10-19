import type { z } from "zod";
import { eventProposalSubmissionWindowSchema } from "../../../../assets/shared/schemas/event-management";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { getActiveEventFormByPurpose, getActiveFormForEvent, toEventFormResolutionEvent } from "../forms";
import { findFormPlacement, prepareFormPlacement, prepareFormPlacementSnapshotGuard } from "../forms/placements";
import { exactEventFlowPlacementGuard } from "./form-placement";
import type { EventRecord } from "../events";

/** Selection and window belong to this event; reusable definitions and historic responses stay intact. */
export async function prepareDirectProposalWindow(
  db: DatabaseLike,
  event: EventRecord,
  window: z.infer<typeof eventProposalSubmissionWindowSchema> | undefined,
  at: string,
  formKey?: string | null,
): Promise<StatementLike[]> {
  const current = await getActiveFormForEvent(
    db,
    toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
    "proposal_submission",
  );
  const exactForm = await getActiveEventFormByPurpose(db, event.id, "proposal_submission");
  const exact = exactForm?.placement ?? null;
  if (exact?.ownerGroupId)
    throw new AppError(
      409,
      "EVENT_MANAGED_BY_GROUP",
      "Group-owned forms must be configured through their owning group",
    );
  const selected =
    formKey === undefined
      ? current && { id: current.id, updated_at: current.formUpdatedAt }
      : formKey === null
        ? null
        : await first<{ id: string; updated_at: string }>(
            db,
            "SELECT id,updated_at FROM forms WHERE key=? AND purpose='proposal_submission' AND status='active' AND (scope_type='global' OR (scope_type='event' AND scope_ref=?))",
            [formKey, event.id],
          );
  if (!selected && (window || formKey))
    throw new AppError(
      409,
      "PROPOSAL_FORM_REQUIRED",
      "Choose an active proposal form available to this event before configuring its submission window",
    );
  const guards: StatementLike[] = [
    exactEventFlowPlacementGuard(db, event.id, "proposal_submission", exact?.id ?? null),
  ];
  if (exact) guards.push(prepareFormPlacementSnapshotGuard(db, exact));
  if (!selected)
    return exact
      ? [...guards, db.prepare("UPDATE form_placements SET active=0,updated_at=? WHERE id=?").bind(at, exact.id)]
      : guards;
  guards.push(
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM forms WHERE id=? AND status='active' AND purpose='proposal_submission' AND updated_at=?",
      bindings: [selected.id, selected.updated_at],
    }),
  );
  const selectedPlacement =
    exact?.formId === selected.id
      ? exact
      : await findFormPlacement(db, selected.id, { contextType: "event", contextRef: event.id });
  if (selectedPlacement?.ownerGroupId)
    throw new AppError(
      409,
      "EVENT_MANAGED_BY_GROUP",
      "Group-owned forms must be configured through their owning group",
    );
  const previousWindow = exact ?? current?.placement;
  const effectiveWindow = window ?? {
    opensAt: previousWindow?.opensAt ?? null,
    closesAt: previousWindow?.closesAt ?? null,
  };
  if (exact && exact.formId !== selected.id)
    guards.push(db.prepare("UPDATE form_placements SET active=0,updated_at=? WHERE id=?").bind(at, exact.id));
  if (selectedPlacement) {
    if (selectedPlacement.id !== exact?.id) guards.push(prepareFormPlacementSnapshotGuard(db, selectedPlacement));
    return [
      ...guards,
      db
        .prepare("UPDATE form_placements SET active=1,opens_at=?,closes_at=?,updated_at=? WHERE id=?")
        .bind(effectiveWindow.opensAt, effectiveWindow.closesAt, at, selectedPlacement.id),
    ];
  }
  return [
    ...guards,
    prepareFormPlacement(
      db,
      selected.id,
      {
        ownerGroupId: null,
        contextType: "event",
        contextRef: event.id,
        audience: "speaker",
        active: true,
        ...effectiveWindow,
      },
      at,
    ).statement,
  ];
}
