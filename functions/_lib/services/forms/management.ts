import { prepareAuditLog } from "../audit";
import { first } from "../../db/queries";
import { stringifyJson } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike, StatementLike } from "../../types";
import type { AdminFormCreateInput, AdminFormUpdateInput } from "../../../../assets/shared/schemas/api";

type FormScope = { type: "global"; ref: null } | { type: "event"; ref: string; eventSlug: string };

interface ManagedFormIdentity {
  id: string;
  key: string;
}

export type ManagedFormRemovalAction = "archived" | "deleted";

function formFieldInsertStatements(
  db: DatabaseLike,
  formId: string,
  fields: AdminFormCreateInput["fields"],
  createdAt: string,
): StatementLike[] {
  return fields.map((field) =>
    db
      .prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uuid(),
        formId,
        field.key,
        field.label,
        field.fieldType,
        field.required ? 1 : 0,
        field.options ? stringifyJson(field.options) : null,
        field.validation ? stringifyJson(field.validation) : null,
        field.sortOrder,
        createdAt,
      ),
  );
}

/** Atomically creates the form aggregate, its fields, and its audit event. */
export async function createManagedForm(
  db: DatabaseLike,
  actorId: string,
  scope: FormScope,
  input: AdminFormCreateInput,
): Promise<ManagedFormIdentity> {
  const id = uuid();
  const now = nowIso();
  const auditAction = scope.type === "event" ? "event_form_created" : "global_form_created";
  const auditDetails = {
    ...(scope.type === "event" ? { eventSlug: scope.eventSlug } : {}),
    key: input.key,
    purpose: input.purpose,
  };

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
    ...formFieldInsertStatements(db, id, input.fields, now),
    prepareAuditLog(db, "admin", actorId, auditAction, "form", id, auditDetails, now),
  ]);

  return { id, key: input.key };
}

/** Atomically updates form metadata, replaces fields when requested, and audits the aggregate change. */
export async function updateManagedForm(
  db: DatabaseLike,
  actorId: string,
  form: ManagedFormIdentity,
  input: AdminFormUpdateInput,
): Promise<void> {
  const now = nowIso();
  const statements: StatementLike[] = [];

  if (input.title !== undefined || input.description !== undefined || input.status !== undefined) {
    statements.push(
      db
        .prepare(
          `UPDATE forms
           SET title = COALESCE(?, title),
               description = IIF(? = 1, description, ?),
               status = COALESCE(?, status),
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.title ?? null,
          input.description === undefined ? 1 : 0,
          input.description ?? null,
          input.status ?? null,
          now,
          form.id,
        ),
    );
  }

  if (input.fields !== undefined) {
    statements.push(
      db.prepare("DELETE FROM form_fields WHERE form_id = ?").bind(form.id),
      ...formFieldInsertStatements(db, form.id, input.fields, now),
      db.prepare("UPDATE forms SET updated_at = ? WHERE id = ?").bind(now, form.id),
    );
  }

  statements.push(
    prepareAuditLog(
      db,
      "admin",
      actorId,
      "form_updated",
      "form",
      form.id,
      { key: form.key, fieldsReplaced: input.fields !== undefined },
      now,
    ),
  );
  await db.batch(statements);
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
  const submissionCount = await first<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM form_submissions WHERE form_id = ?",
    [form.id],
  );
  const now = nowIso();
  if (Number(submissionCount?.total ?? 0) > 0) {
    await db.batch([
      db.prepare("UPDATE forms SET status = 'archived', updated_at = ? WHERE id = ?").bind(now, form.id),
      prepareAuditLog(db, "admin", actorId, "form_archived", "form", form.id, { key: form.key }, now),
    ]);
    return "archived";
  }

  await db.batch([
    db.prepare("DELETE FROM form_fields WHERE form_id = ?").bind(form.id),
    db.prepare("DELETE FROM forms WHERE id = ?").bind(form.id),
    prepareAuditLog(db, "admin", actorId, "form_deleted", "form", form.id, { key: form.key }, now),
  ]);
  return "deleted";
}
