import { prepareAuditLog, type AuditScope } from "../audit";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike, StatementLike } from "../../types";
import type { FormDefinitionCreateInput, FormDefinitionUpdateInput } from "../../../../assets/shared/schemas/forms";
import { prepareFieldReconciliation } from "./field-reconciliation";
import {
  formChangedError,
  isFormDeletionEvidenceConflict,
  isFormMutationConflict,
  prepareFormDeletionGuard,
  prepareFormMutationGuard,
} from "./mutation-guard";
import { defaultFormAudience, prepareFormPlacement } from "./placements";

type FormScope =
  | { type: "global"; ref: null }
  | { type: "event"; ref: string; eventSlug: string }
  | {
      type: "group";
      ref: string;
      groupId: string;
      placement?: { contextType: "event"; contextRef: string; audience: string };
    };

export interface ManagedFormMutationOptions {
  authorizationGuards?: StatementLike[];
  auditScope?: AuditScope;
  auditAction?: string;
  /** Keeps one installation-owned placement usable when a singleton form is reactivated. */
  synchronizeInstallationPlacementStatus?: boolean;
}

interface ManagedFormIdentity {
  id: string;
  key: string;
  updated_at: string;
}

interface CreatedManagedFormIdentity extends ManagedFormIdentity {
  placementId: string;
}

export interface PreparedManagedForm extends CreatedManagedFormIdentity {
  statements: StatementLike[];
}

export type ManagedFormRemovalAction = "archived" | "deleted";

/** Prepares a form aggregate so another domain command can commit it atomically. */
export async function prepareManagedForm(
  db: DatabaseLike,
  actorId: string,
  scope: FormScope,
  input: FormDefinitionCreateInput,
  options: ManagedFormMutationOptions = {},
): Promise<PreparedManagedForm> {
  const id = uuid();
  const now = nowIso();
  const auditAction =
    options.auditAction ??
    (scope.type === "event"
      ? "event_form_created"
      : scope.type === "group"
        ? "group_form_created"
        : "global_form_created");
  const auditDetails = {
    ...(scope.type === "event" ? { eventSlug: scope.eventSlug } : {}),
    ...(scope.type === "group" ? { groupId: scope.groupId } : {}),
    key: input.key,
    purpose: input.purpose,
  };
  const fieldStatements = await prepareFieldReconciliation(db, id, input.fields, now);
  // `community` is the deployed SQLite value for a group-owned definition.
  // Group identity and authorization remain normalized on the placement FK.
  const persistedScopeType = scope.type === "group" ? "community" : scope.type;
  const placement = prepareFormPlacement(
    db,
    id,
    {
      ownerGroupId: scope.type === "group" ? scope.groupId : null,
      contextType:
        scope.type === "event"
          ? "event"
          : scope.type === "group"
            ? (scope.placement?.contextType ?? "group")
            : "installation",
      contextRef: scope.type === "group" ? (scope.placement?.contextRef ?? scope.ref) : scope.ref,
      audience:
        scope.type === "group"
          ? (scope.placement?.audience ?? defaultFormAudience(input.purpose))
          : defaultFormAudience(input.purpose),
      active: input.status === "active",
    },
    now,
  );

  return {
    id,
    key: input.key,
    updated_at: now,
    placementId: placement.id,
    statements: [
      ...(options.authorizationGuards ?? []),
      db
        .prepare(
          `INSERT INTO forms
           (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.key,
          persistedScopeType,
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
      prepareAuditLog(db, "admin", actorId, auditAction, "form", id, auditDetails, now, null, options.auditScope),
    ],
  };
}

/** Atomically creates the form aggregate, its fields, and its audit event. */
export async function createManagedForm(
  db: DatabaseLike,
  actorId: string,
  scope: FormScope,
  input: FormDefinitionCreateInput,
  options: ManagedFormMutationOptions = {},
): Promise<CreatedManagedFormIdentity> {
  const prepared = await prepareManagedForm(db, actorId, scope, input, options);
  await db.batch(prepared.statements);

  return { id: prepared.id, key: prepared.key, updated_at: prepared.updated_at, placementId: prepared.placementId };
}

/** Atomically updates metadata, reconciles stable fields, and audits the aggregate change. */
export async function updateManagedForm(
  db: DatabaseLike,
  actorId: string,
  form: ManagedFormIdentity,
  input: FormDefinitionUpdateInput,
  options: ManagedFormMutationOptions = {},
): Promise<void> {
  const now = nowIso();
  const statements: StatementLike[] = [
    ...(options.authorizationGuards ?? []),
    prepareFormMutationGuard(db, form.id, form.updated_at, now),
  ];

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
    if (options.synchronizeInstallationPlacementStatus && input.status) {
      statements.push(
        db
          .prepare(
            `UPDATE form_placements
             SET active = ?, updated_at = ?
             WHERE form_id = ? AND context_type = 'installation' AND context_ref IS NULL`,
          )
          .bind(input.status === "active" ? 1 : 0, now, form.id),
      );
    } else if (input.status && input.status !== "active") {
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
      options.auditAction ?? "form_updated",
      "form",
      form.id,
      { key: form.key, fieldsReconciled: input.fields !== undefined },
      now,
      null,
      options.auditScope,
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
      db
        .prepare(
          `DELETE FROM form_placement_group_grants
            WHERE placement_id IN (SELECT id FROM form_placements WHERE form_id = ?)`,
        )
        .bind(form.id),
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
