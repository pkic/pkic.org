import { prepareAuditLog } from "../audit";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike, StatementLike } from "../../types";
import type { AdminFormCreateInput, AdminFormUpdateInput } from "../../../../assets/shared/schemas/admin-forms";
import { prepareFieldReconciliation } from "./field-reconciliation";
import {
  formChangedError,
  isFormDeletionEvidenceConflict,
  isFormMutationConflict,
  prepareFormDeletionGuard,
  prepareFormMutationGuard,
} from "./mutation-guard";
import { defaultFormAudience, prepareFormPlacement } from "./placements";

type FormScope = { type: "global"; ref: null } | { type: "event"; ref: string; eventSlug: string };

interface ManagedFormIdentity {
  id: string;
  key: string;
  updated_at: string;
}

interface CreatedManagedFormIdentity extends ManagedFormIdentity {
  placementId: string;
}

export type ManagedFormRemovalAction = "archived" | "deleted";

/** Atomically creates the form aggregate, its fields, and its audit event. */
export async function createManagedForm(
  db: DatabaseLike,
  actorId: string,
  scope: FormScope,
  input: AdminFormCreateInput,
): Promise<CreatedManagedFormIdentity> {
  const id = uuid();
  const now = nowIso();
  const auditAction = scope.type === "event" ? "event_form_created" : "global_form_created";
  const auditDetails = {
    ...(scope.type === "event" ? { eventSlug: scope.eventSlug } : {}),
    key: input.key,
    purpose: input.purpose,
  };
  const fieldStatements = await prepareFieldReconciliation(db, id, input.fields, now);
  const placement = prepareFormPlacement(
    db,
    id,
    {
      ownerGroupId: null,
      contextType: scope.type === "event" ? "event" : "installation",
      contextRef: scope.ref,
      audience: defaultFormAudience(input.purpose),
      active: input.status === "active",
    },
    now,
  );

  await db.batch([
    db
      .prepare(
        `INSERT INTO forms
           (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.key,
        scope.type,
        scope.ref,
        input.purpose,
        input.status,
        input.title,
        input.description ?? null,
        now,
        now,
      ),
    ...fieldStatements,
    placement.statement,
    prepareAuditLog(db, "admin", actorId, auditAction, "form", id, auditDetails, now),
  ]);

  return { id, key: input.key, updated_at: now, placementId: placement.id };
}

/** Atomically updates metadata, reconciles stable fields, and audits the aggregate change. */
export async function updateManagedForm(
  db: DatabaseLike,
  actorId: string,
  form: ManagedFormIdentity,
  input: AdminFormUpdateInput,
): Promise<void> {
  const now = nowIso();
  const statements: StatementLike[] = [prepareFormMutationGuard(db, form.id, form.updated_at, now)];

  if (input.title !== undefined || input.description !== undefined || input.status !== undefined) {
    statements.push(
      db
        .prepare(
          `UPDATE forms
           SET title = COALESCE(?, title),
               description = IIF(? = 1, description, ?),
               status = COALESCE(?, status)
           WHERE id = ?`,
        )
        .bind(
          input.title ?? null,
          input.description === undefined ? 1 : 0,
          input.description ?? null,
          input.status ?? null,
          form.id,
        ),
    );
    if (input.status && input.status !== "active") {
      statements.push(
        db
          .prepare("UPDATE form_placements SET active = 0, updated_at = ? WHERE form_id = ? AND active = 1")
          .bind(now, form.id),
      );
    }
  }

  if (input.fields !== undefined) {
    statements.push(...(await prepareFieldReconciliation(db, form.id, input.fields, now)));
  }

  statements.push(
    prepareAuditLog(
      db,
      "admin",
      actorId,
      "form_updated",
      "form",
      form.id,
      { key: form.key, fieldsReconciled: input.fields !== undefined },
      now,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isFormMutationConflict(error)) throw formChangedError();
    throw error;
  }
}

/**
 * Atomically archives a submitted form, or removes an unused aggregate, and
 * records the corresponding audit event in the same D1 transaction.
 */
export async function removeManagedForm(
  db: DatabaseLike,
  actorId: string,
  form: ManagedFormIdentity,
): Promise<ManagedFormRemovalAction> {
  const now = nowIso();
  try {
    await db.batch([
      prepareFormMutationGuard(db, form.id, form.updated_at, now),
      prepareFormDeletionGuard(db, form.id),
      db.prepare("DELETE FROM form_group_grants WHERE form_id = ?").bind(form.id),
      db.prepare("DELETE FROM form_placements WHERE form_id = ?").bind(form.id),
      db.prepare("DELETE FROM form_fields WHERE form_id = ?").bind(form.id),
      db.prepare("DELETE FROM forms WHERE id = ?").bind(form.id),
      prepareAuditLog(db, "admin", actorId, "form_deleted", "form", form.id, { key: form.key }, now),
    ]);
    return "deleted";
  } catch (error) {
    if (isFormMutationConflict(error)) throw formChangedError();
    if (!isFormDeletionEvidenceConflict(error)) throw error;

    try {
      await db.batch([
        prepareFormMutationGuard(db, form.id, form.updated_at, now),
        db.prepare("UPDATE forms SET status = 'archived' WHERE id = ?").bind(form.id),
        db.prepare("UPDATE form_placements SET active = 0, updated_at = ? WHERE form_id = ?").bind(now, form.id),
        prepareAuditLog(db, "admin", actorId, "form_archived", "form", form.id, { key: form.key }, now),
      ]);
    } catch (error) {
      if (isFormMutationConflict(error)) throw formChangedError();
      throw error;
    }
    return "archived";
  }
}
