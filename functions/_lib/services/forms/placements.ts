import type {
  FormPlacement,
  FormPlacementCreateInput,
  FormPlacementsListQuery,
  FormPlacementUpdateInput,
} from "../../../../assets/shared/schemas/forms";
import { formPlacementCreateSchema } from "../../../../assets/shared/schemas/forms";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import {
  isAuditOneChangeGuardFailure,
  prepareAuditLog,
  prepareAuditLogAfterOneChange,
  type AuditScope,
} from "../audit";

export interface FormPlacementRow {
  id: string;
  form_id: string;
  owner_group_id: string | null;
  context_type: FormPlacement["contextType"];
  context_ref: string | null;
  audience: string;
  active: number;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreparedFormPlacement {
  id: string;
  statement: StatementLike;
}

export const FORM_PLACEMENT_COLUMNS = `id, form_id, owner_group_id, context_type, context_ref,
  audience, active, opens_at, closes_at, created_at, updated_at`;

export function mapFormPlacement(row: FormPlacementRow): FormPlacement {
  return {
    id: row.id,
    formId: row.form_id,
    ownerGroupId: row.owner_group_id,
    contextType: row.context_type,
    contextRef: row.context_ref,
    audience: row.audience,
    active: row.active === 1,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Revalidates every mutable placement attribute before a cross-aggregate
 * command changes the placement. `IS` keeps the nullable columns
 * null-safe, so a placement moved to another context cannot be acted on by a
 * stale read from the caller.
 */
export function prepareFormPlacementSnapshotGuard(
  db: DatabaseLike,
  placement: Pick<
    FormPlacement,
    | "id"
    | "formId"
    | "ownerGroupId"
    | "contextType"
    | "contextRef"
    | "audience"
    | "active"
    | "opensAt"
    | "closesAt"
    | "updatedAt"
  >,
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM form_placements
           WHERE id = ?
             AND form_id = ?
             AND owner_group_id IS ?
             AND context_type = ?
             AND context_ref IS ?
             AND audience = ?
             AND active = ?
             AND opens_at IS ?
             AND closes_at IS ?
             AND updated_at = ?
           LIMIT 1`,
    bindings: [
      placement.id,
      placement.formId,
      placement.ownerGroupId,
      placement.contextType,
      placement.contextRef,
      placement.audience,
      placement.active ? 1 : 0,
      placement.opensAt,
      placement.closesAt,
      placement.updatedAt,
    ],
  });
}

export function defaultFormAudience(purpose: string): string {
  if (purpose === "event_registration") return "attendee";
  if (purpose === "proposal_submission") return "speaker";
  if (purpose === "application") return "prospective_member";
  return purpose;
}

export function prepareFormPlacement(
  db: DatabaseLike,
  formId: string,
  input: FormPlacementCreateInput,
  timestamp = nowIso(),
): PreparedFormPlacement {
  const id = uuid();
  return {
    id,
    statement: db
      .prepare(
        `INSERT INTO form_placements
           (id, form_id, owner_group_id, context_type, context_ref, audience, active,
            opens_at, closes_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        formId,
        input.ownerGroupId,
        input.contextType,
        input.contextRef,
        input.audience,
        input.active ? 1 : 0,
        input.opensAt ?? null,
        input.closesAt ?? null,
        timestamp,
        timestamp,
      ),
  };
}

export async function createManagedFormPlacement(
  db: DatabaseLike,
  actorId: string,
  formId: string,
  input: FormPlacementCreateInput,
): Promise<FormPlacement> {
  const now = nowIso();
  const prepared = prepareFormPlacement(db, formId, input, now);
  try {
    await db.batch([
      prepared.statement,
      prepareAuditLog(
        db,
        "admin",
        actorId,
        "form_placement_created",
        "form_placement",
        prepared.id,
        { formId, contextType: input.contextType, contextRef: input.contextRef, audience: input.audience },
        now,
      ),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("uq_form_placements_context") || message.includes("UNIQUE constraint failed")) {
      throw new AppError(409, "FORM_PLACEMENT_EXISTS", "This form already has the requested placement");
    }
    if (message.includes("form placement context is invalid") || message.includes("FOREIGN KEY constraint failed")) {
      throw new AppError(400, "INVALID_FORM_PLACEMENT", "The placement references an unavailable context");
    }
    throw error;
  }
  return {
    id: prepared.id,
    formId,
    ownerGroupId: input.ownerGroupId,
    contextType: input.contextType,
    contextRef: input.contextRef,
    audience: input.audience,
    active: input.active,
    opensAt: input.opensAt ?? null,
    closesAt: input.closesAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

async function getFormPlacementRow(
  db: DatabaseLike,
  formId: string,
  placementId: string,
): Promise<FormPlacementRow | null> {
  return db
    .prepare(`SELECT ${FORM_PLACEMENT_COLUMNS} FROM form_placements WHERE id = ? AND form_id = ?`)
    .bind(placementId, formId)
    .first<FormPlacementRow>();
}

export async function updateManagedFormPlacement(
  db: DatabaseLike,
  actorId: string,
  formId: string,
  placementId: string,
  input: FormPlacementUpdateInput,
  auditScope: AuditScope | null = null,
  authorizationGuards: readonly StatementLike[] = [],
): Promise<FormPlacement> {
  const currentRow = await getFormPlacementRow(db, formId, placementId);
  if (!currentRow) throw new AppError(404, "FORM_PLACEMENT_NOT_FOUND", "Form placement not found");
  if (Object.keys(input).length === 0) return mapFormPlacement(currentRow);

  const current = mapFormPlacement(currentRow);
  const next = formPlacementCreateSchema.parse({
    ownerGroupId: input.ownerGroupId === undefined ? current.ownerGroupId : input.ownerGroupId,
    contextType: input.contextType ?? current.contextType,
    contextRef: input.contextRef === undefined ? current.contextRef : input.contextRef,
    audience: input.audience ?? current.audience,
    active: input.active ?? current.active,
    opensAt: input.opensAt === undefined ? current.opensAt : input.opensAt,
    closesAt: input.closesAt === undefined ? current.closesAt : input.closesAt,
  });
  const now = nowIso();
  try {
    await db.batch([
      ...authorizationGuards,
      db
        .prepare(
          `UPDATE form_placements
           SET owner_group_id = ?, context_type = ?, context_ref = ?, audience = ?, active = ?,
               opens_at = ?, closes_at = ?, updated_at = ?
           WHERE id = ? AND form_id = ? AND updated_at = ?`,
        )
        .bind(
          next.ownerGroupId,
          next.contextType,
          next.contextRef,
          next.audience,
          next.active ? 1 : 0,
          next.opensAt ?? null,
          next.closesAt ?? null,
          now,
          placementId,
          formId,
          current.updatedAt,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actorId,
        "form_placement_updated",
        "form_placement",
        placementId,
        input,
        now,
        auditScope,
      ),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "FORM_PLACEMENT_CHANGED", "The form placement changed; reload and retry");
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("uq_form_placements_context") || message.includes("UNIQUE constraint failed")) {
      throw new AppError(409, "FORM_PLACEMENT_EXISTS", "This form already has the requested placement");
    }
    if (message.includes("form placement context is invalid") || message.includes("FOREIGN KEY constraint failed")) {
      throw new AppError(400, "INVALID_FORM_PLACEMENT", "The placement references an unavailable context");
    }
    throw error;
  }
  return {
    ...next,
    opensAt: next.opensAt ?? null,
    closesAt: next.closesAt ?? null,
    id: placementId,
    formId,
    createdAt: current.createdAt,
    updatedAt: now,
  };
}

export async function listFormPlacements(
  db: DatabaseLike,
  formId: string,
  query: FormPlacementsListQuery,
): Promise<{ placements: FormPlacement[]; total: number }> {
  const conditions = ["form_id = ?"];
  const bindings: unknown[] = [formId];
  if (query.ownerGroupId) {
    conditions.push("owner_group_id = ?");
    bindings.push(query.ownerGroupId);
  }
  if (query.contextType) {
    conditions.push("context_type = ?");
    bindings.push(query.contextType);
  }
  if (query.contextRef) {
    conditions.push("context_ref = ?");
    bindings.push(query.contextRef);
  }
  if (query.active) {
    conditions.push("active = ?");
    bindings.push(query.active === "true" ? 1 : 0);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["audience", "context_ref"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const orderBy = resolveMappedOrderBy(
    query.sort,
    { audience: "audience COLLATE NOCASE", opens_at: "opens_at", created_at: "created_at" },
    "created_at DESC",
    "id ASC",
  );
  const page = await queryPage<FormPlacementRow>(db, {
    source: {
      selectSql: `SELECT ${FORM_PLACEMENT_COLUMNS}`,
      fromSql: `FROM form_placements WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  return { placements: page.rows.map(mapFormPlacement), total: page.total };
}

async function queryFormPlacement(
  db: DatabaseLike,
  formId: string,
  selector: { placementId?: string; contextType?: FormPlacement["contextType"]; contextRef?: string | null },
  activeOnly: boolean,
): Promise<FormPlacement | null> {
  const conditions = ["form_id = ?"];
  const bindings: unknown[] = [formId];
  if (activeOnly) conditions.push("active = 1");
  if (selector.placementId) {
    conditions.push("id = ?");
    bindings.push(selector.placementId);
  }
  if (selector.contextType) {
    conditions.push("context_type = ?", "context_ref IS ?");
    bindings.push(selector.contextType, selector.contextRef ?? null);
  }
  const result = await db
    .prepare(
      `SELECT ${FORM_PLACEMENT_COLUMNS}
       FROM form_placements
       WHERE ${conditions.join(" AND ")}
         ${activeOnly ? "AND (opens_at IS NULL OR unixepoch(opens_at) <= unixepoch())" : ""}
         ${activeOnly ? "AND (closes_at IS NULL OR unixepoch(closes_at) > unixepoch())" : ""}
       ORDER BY created_at ASC, id ASC
       LIMIT 2`,
    )
    .bind(...bindings)
    .all<FormPlacementRow>();
  const rows = result.results ?? [];
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new AppError(400, "FORM_PLACEMENT_REQUIRED", "Select the form placement whose responses you want");
  }
  return mapFormPlacement(rows[0]);
}

/** Resolves response history regardless of whether collection is still open. */
export function findFormPlacement(
  db: DatabaseLike,
  formId: string,
  selector: { placementId?: string; contextType?: FormPlacement["contextType"]; contextRef?: string | null },
): Promise<FormPlacement | null> {
  return queryFormPlacement(db, formId, selector, false);
}

/** Resolves a placement that currently permits response collection. */
export function findActiveFormPlacement(
  db: DatabaseLike,
  formId: string,
  selector: { placementId?: string; contextType?: FormPlacement["contextType"]; contextRef?: string | null },
): Promise<FormPlacement | null> {
  return queryFormPlacement(db, formId, selector, true);
}

export async function requireActiveFormPlacement(
  db: DatabaseLike,
  formId: string,
  selector: { placementId?: string; contextType?: FormPlacement["contextType"]; contextRef?: string | null },
): Promise<FormPlacement> {
  const placement = await findActiveFormPlacement(db, formId, selector);
  if (!placement) {
    throw new AppError(404, "FORM_PLACEMENT_NOT_FOUND", "No active form placement matches this response set");
  }
  return placement;
}
