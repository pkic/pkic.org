import type { z } from "zod";
import type { EventFormsPurpose } from "../../../../assets/shared/schemas/forms";
import type { eventProposalSubmissionWindowSchema } from "../../../../assets/shared/schemas/event-management";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, D1StatementResult } from "../../types";
import {
  placedEventFormSelection,
  decodePlacedEventForm,
  type PlacedEventFormRow,
} from "../forms/event-placement-read";
import {
  defaultFormAudience,
  prepareFormPlacement,
  prepareFormPlacementRead,
  prepareFormPlacementSnapshotGuard,
  type FormPlacementRow,
} from "../forms/placements";
import { exactEventFlowPlacementGuard } from "./form-placement";
import type { EventRecord } from "../events";
import type { EventSettingsUpdateInput } from "../../../../assets/shared/schemas/event-management";

/** A single preflight snapshot plans the event's explicit selection and window; the caller commits it atomically. */
export function prepareDirectEventFormSelectionRead(
  db: DatabaseLike,
  event: Pick<EventRecord, "id">,
  purpose: EventFormsPurpose,
  at: string,
  formKey?: string | null,
  window?: z.infer<typeof eventProposalSubmissionWindowSchema>,
) {
  const current = placedEventFormSelection(event.id, purpose, { includeClosed: true });
  const previousSelection = prepareFormPlacementRead(
    db,
    { key: formKey ?? "" },
    {
      contextType: "event",
      contextRef: event.id,
      audience: defaultFormAudience(purpose),
    },
    false,
  );
  return {
    statements: [
      db.prepare(current.sql).bind(...current.bindings),
      db
        .prepare(`SELECT id,updated_at FROM forms WHERE key=? AND purpose=? AND status='active'
      AND (scope_type='global' OR (scope_type='event' AND scope_ref=?))`)
        .bind(formKey ?? null, purpose, event.id),
      previousSelection.statement,
    ],
    decode(results: D1StatementResult[]): StatementLike[] {
      const [currentResult, selectedResult, placementResult] = results;
      const resolved = decodePlacedEventForm(batchRows<PlacedEventFormRow>(currentResult));
      const exact = resolved?.placement ?? null;
      if (exact?.ownerGroupId)
        throw new AppError(
          409,
          "EVENT_MANAGED_BY_GROUP",
          "Group-owned forms must be configured through their owning group",
        );
      const selected =
        formKey === undefined
          ? resolved && { id: resolved.form.id, updated_at: resolved.form.updated_at }
          : formKey === null
            ? null
            : batchFirst<{ id: string; updated_at: string }>(selectedResult);
      if (!selected && (window || formKey))
        throw new AppError(
          409,
          purpose === "proposal_submission" ? "PROPOSAL_FORM_REQUIRED" : "REGISTRATION_FORM_REQUIRED",
          "Choose an active form available to this event before configuring its selection or submission window",
        );
      const guards: StatementLike[] = [exactEventFlowPlacementGuard(db, event.id, purpose, exact?.id ?? null)];
      if (exact) guards.push(prepareFormPlacementSnapshotGuard(db, exact));
      if (!selected)
        return exact
          ? [...guards, db.prepare("UPDATE form_placements SET active=0,updated_at=? WHERE id=?").bind(at, exact.id)]
          : guards;
      guards.push(
        prepareAuthorizationGuard(db, {
          sql: `SELECT 1 FROM forms WHERE id=? AND status='active' AND purpose=? AND updated_at=?
      AND (scope_type='global' OR (scope_type='event' AND scope_ref=?))`,
          bindings: [selected.id, purpose, selected.updated_at, event.id],
        }),
      );
      const selectedPlacement =
        exact?.formId === selected.id ? exact : previousSelection.decode(batchRows<FormPlacementRow>(placementResult));
      if (selectedPlacement?.ownerGroupId)
        throw new AppError(
          409,
          "EVENT_MANAGED_BY_GROUP",
          "Group-owned forms must be configured through their owning group",
        );
      const effectiveWindow = window ?? { opensAt: exact?.opensAt ?? null, closesAt: exact?.closesAt ?? null };
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
            audience: defaultFormAudience(purpose),
            active: true,
            ...effectiveWindow,
          },
          at,
        ).statement,
      ];
    },
  };
}

/** Share selection planning across direct and group-authorized event settings commits. */
export function prepareEventFormSettingsRead(
  db: DatabaseLike,
  event: Pick<EventRecord, "id">,
  settings: Pick<EventSettingsUpdateInput, "registrationFormKey" | "proposalFormKey" | "proposalSubmissionWindow">,
  at: string,
) {
  const reads = [
    ...(settings.registrationFormKey === undefined
      ? []
      : [prepareDirectEventFormSelectionRead(db, event, "event_registration", at, settings.registrationFormKey)]),
    ...(settings.proposalSubmissionWindow === undefined && settings.proposalFormKey === undefined
      ? []
      : [
          prepareDirectEventFormSelectionRead(
            db,
            event,
            "proposal_submission",
            at,
            settings.proposalFormKey,
            settings.proposalSubmissionWindow,
          ),
        ]),
  ];
  return {
    statements: reads.flatMap((read) => read.statements),
    decode(results: D1StatementResult[]): StatementLike[] {
      let offset = 0;
      return reads.flatMap((read) => {
        const planned = read.decode(results.slice(offset, offset + read.statements.length));
        offset += read.statements.length;
        return planned;
      });
    },
  };
}

/** Standalone adapter for commands that select one event flow. */
export async function prepareDirectEventFormSelection(
  db: DatabaseLike,
  event: EventRecord,
  purpose: EventFormsPurpose,
  at: string,
  formKey?: string | null,
  window?: z.infer<typeof eventProposalSubmissionWindowSchema>,
): Promise<StatementLike[]> {
  const read = prepareDirectEventFormSelectionRead(db, event, purpose, at, formKey, window);
  return read.decode(await db.batch(read.statements));
}
