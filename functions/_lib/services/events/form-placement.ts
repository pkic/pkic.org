import type {
  EventFormsPurpose,
  FormDefinitionCreateInput,
  FormPlacement,
} from "../../../../assets/shared/schemas/forms";
import type { GroupEventFormsQuery } from "../../../../assets/shared/schemas/group-event-forms";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import {
  commitEventResourceManagementBatch,
  guardEventResourceManagementDatabase,
  queryEventResourceManagementPage,
  requireEventResourceManagementContext,
  type EventResourceManagementContext,
} from "../event-series/management";
import { EVENT_COLUMNS, type EventRecord } from "../events";
import { prepareManagedForm } from "../forms/management";
import { prepareFormPlacement, prepareFormPlacementSnapshotGuard } from "../forms/placements";

interface EventFlowFormRow {
  placement_id: string;
  form_id: string;
  owner_group_id: string | null;
  context_type: FormPlacement["contextType"];
  context_ref: string | null;
  audience: string;
  active: number;
  opens_at: string | null;
  closes_at: string | null;
  placement_created_at: string;
  placement_updated_at: string;
  form_key: string;
  form_purpose: string;
  form_status: string;
  form_scope_type: string;
  form_scope_ref: string | null;
  form_title: string;
  form_description: string | null;
}

export interface EventFlowFormSummary {
  placement: FormPlacement;
  form: { id: string; key: string; title: string; description: string | null };
}

export interface ConfigurableGroupEvent extends EventRecord {
  updated_at: string;
}

export interface GroupEventFormContext {
  event: ConfigurableGroupEvent;
  /** The event aggregate owns its forms even when management is delegated through another group. */
  ownerGroupId: string;
  context: EventResourceManagementContext;
  guardedDb: DatabaseLike;
}

const EVENT_FLOW_FORM_SELECT = `SELECT
  placement.id AS placement_id, placement.form_id, placement.owner_group_id,
  placement.context_type, placement.context_ref, placement.audience,
  placement.active, placement.opens_at, placement.closes_at,
  placement.created_at AS placement_created_at,
  placement.updated_at AS placement_updated_at,
  form.key AS form_key, form.purpose AS form_purpose, form.status AS form_status,
  form.scope_type AS form_scope_type, form.scope_ref AS form_scope_ref,
  form.title AS form_title, form.description AS form_description
 FROM form_placements placement
 JOIN forms form ON form.id = placement.form_id`;

export function eventFormAudience(purpose: EventFormsPurpose): "attendee" | "speaker" {
  return purpose === "event_registration" ? "attendee" : "speaker";
}

function eventFormLabel(purpose: EventFormsPurpose): string {
  return purpose === "event_registration" ? "attendee" : "proposal";
}

function mapEventFlowForm(row: EventFlowFormRow): EventFlowFormSummary {
  return {
    placement: {
      id: row.placement_id,
      formId: row.form_id,
      ownerGroupId: row.owner_group_id,
      contextType: row.context_type,
      contextRef: row.context_ref,
      audience: row.audience,
      active: row.active === 1,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      createdAt: row.placement_created_at,
      updatedAt: row.placement_updated_at,
    },
    form: {
      id: row.form_id,
      key: row.form_key,
      title: row.form_title,
      description: row.form_description,
    },
  };
}

/**
 * Returns the structurally selected exact placement for an event flow, never a
 * fallback definition. Management must see a selected form even before it
 * opens or after it closes; response collection applies that time-window rule
 * separately.
 */
export async function findExactEventFlowForm(
  db: DatabaseLike,
  eventId: string,
  groupId: string,
  purpose: EventFormsPurpose,
): Promise<EventFlowFormSummary | null> {
  const rows = await db
    .prepare(
      `${EVENT_FLOW_FORM_SELECT}
        WHERE placement.context_type = 'event'
          AND placement.context_ref = ?
          AND placement.audience = ?
          AND placement.active = 1
          AND form.purpose = ?
          AND form.status = 'active'
        ORDER BY placement.created_at ASC, placement.id ASC
        LIMIT 2`,
    )
    .bind(eventId, eventFormAudience(purpose), purpose)
    .all<EventFlowFormRow>();
  if (rows.results.length > 1) {
    throw new AppError(
      409,
      "EVENT_FLOW_FORM_AMBIGUOUS",
      `Multiple active ${eventFormLabel(purpose)} forms are configured`,
    );
  }
  const row = rows.results[0];
  if (
    row &&
    (row.owner_group_id !== groupId || row.form_scope_type !== "community" || row.form_scope_ref !== groupId)
  ) {
    throw new AppError(
      409,
      "EVENT_FLOW_FORM_INVALID",
      `The selected ${eventFormLabel(purpose)} form is no longer owned by this group`,
    );
  }
  return row ? mapEventFlowForm(row) : null;
}

/** Rechecks the immutable event-flow ownership snapshot in the mutation batch. */
export function eventFlowLifecycleGuard(db: DatabaseLike, eventId: string, ownerGroupId: string): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
           FROM events guarded_event
           WHERE guarded_event.id = ?
             AND guarded_event.source_mode = 'portal'
             AND guarded_event.owner_group_id = ?
             AND COALESCE(guarded_event.profile_key, '') NOT IN ('meeting', 'board_meeting')
             AND NOT EXISTS (
               SELECT 1 FROM event_series guarded_series WHERE guarded_series.event_id = guarded_event.id
             )
           LIMIT 1`,
    bindings: [eventId, ownerGroupId],
  });
}

function formDefinitionGuard(
  db: DatabaseLike,
  groupId: string,
  formId: string,
  purpose: EventFormsPurpose,
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM forms form
           WHERE form.id = ?
             AND form.purpose = ?
             AND form.status = 'active'
             AND form.scope_type = 'community'
             AND form.scope_ref = ?
           LIMIT 1`,
    bindings: [formId, purpose, groupId],
  });
}

/** Prevents two concurrent writers from selecting separate active placements for one event flow. */
function exactEventFlowPlacementGuard(
  db: DatabaseLike,
  eventId: string,
  purpose: EventFormsPurpose,
  allowedCurrentPlacementId: string | null,
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            WHERE NOT EXISTS (
              SELECT 1
                FROM form_placements placement
                JOIN forms form ON form.id = placement.form_id
               WHERE placement.context_type = 'event'
                 AND placement.context_ref = ?
                 AND placement.audience = ?
                 AND placement.active = 1
                 AND form.purpose = ?
                 AND form.status = 'active'
                 AND (? IS NULL OR placement.id <> ?)
            )`,
    bindings: [eventId, eventFormAudience(purpose), purpose, allowedCurrentPlacementId, allowedCurrentPlacementId],
  });
}

async function findReusableGroupEventForm(
  db: DatabaseLike,
  groupId: string,
  formId: string,
  purpose: EventFormsPurpose,
): Promise<{ id: string; key: string; title: string; description: string | null } | null> {
  return first(
    db,
    `SELECT form.id, form.key, form.title, form.description
       FROM forms form
      WHERE form.id = ?
        AND form.purpose = ?
        AND form.status = 'active'
        AND form.scope_type = 'community'
        AND form.scope_ref = ?`,
    [formId, purpose, groupId],
  );
}

/** Resolves the live event-management capability once for every flow mutation or list. */
export async function requireConfigurableGroupEvent(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
): Promise<GroupEventFormContext> {
  const event = await first<ConfigurableGroupEvent>(
    db,
    `SELECT ${EVENT_COLUMNS}, updated_at FROM events WHERE id = ?`,
    [eventId],
  );
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  if (event.profile_key === "meeting" || event.profile_key === "board_meeting") {
    throw new AppError(
      409,
      "EVENT_MANAGED_BY_MEETING_SERIES",
      "Meeting events must be configured through their series",
    );
  }
  if (event.source_mode !== "portal") {
    throw new AppError(
      409,
      "EVENT_GROUP_FORMS_REQUIRE_PORTAL_EVENT",
      "Event-flow forms for Hugo and integration events remain in their explicit compatibility configuration.",
    );
  }
  if (!event.owner_group_id) {
    throw new AppError(409, "EVENT_GROUP_OWNER_REQUIRED", "Portal event ownership is not configured");
  }
  const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, "manage");
  return {
    event,
    ownerGroupId: event.owner_group_id,
    context,
    guardedDb: guardEventResourceManagementDatabase(db, actor, context, "manage"),
  };
}

export async function getGroupEventForm(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  purpose: EventFormsPurpose,
) {
  const { event, ownerGroupId, guardedDb } = await requireConfigurableGroupEvent(db, actor, groupIdOrSlug, eventId);
  return {
    eventUpdatedAt: event.updated_at,
    purpose,
    form: await findExactEventFlowForm(guardedDb, event.id, ownerGroupId, purpose),
  };
}

export async function listGroupEventAvailableForms(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  purpose: EventFormsPurpose,
  query: GroupEventFormsQuery,
) {
  const { context, ownerGroupId } = await requireConfigurableGroupEvent(db, actor, groupIdOrSlug, eventId);
  const conditions = [
    "form.scope_type = 'community'",
    "form.scope_ref = ?",
    "form.purpose = ?",
    "form.status = 'active'",
  ];
  const bindings: unknown[] = [ownerGroupId, purpose];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["form.key", "form.title", "form.description"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  return queryEventResourceManagementPage<{
    id: string;
    key: string;
    title: string;
    description: string | null;
    updatedAt: string;
  }>(db, actor, context, "manage", {
    source: {
      selectSql: "SELECT form.id, form.key, form.title, form.description, form.updated_at AS updatedAt",
      fromSql: `FROM forms form WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { key: "form.key COLLATE NOCASE", title: "form.title COLLATE NOCASE", updated_at: "form.updated_at" },
      "form.updated_at DESC",
      "form.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
}

interface PreparedEventFormPlacementChange {
  form: EventFlowFormSummary | null;
  statements: StatementLike[];
}

/** Builds only the placement transition so event-specific policy can share one atomic D1 command. */
export async function prepareEventFormPlacementChange(
  db: DatabaseLike,
  input: {
    event: ConfigurableGroupEvent;
    context: EventResourceManagementContext;
    ownerGroupId: string;
    purpose: EventFormsPurpose;
    formId: string | null;
    timestamp: string;
  },
): Promise<PreparedEventFormPlacementChange> {
  const current = await findExactEventFlowForm(db, input.event.id, input.ownerGroupId, input.purpose);
  if (input.formId === null) {
    if (!current) return { form: null, statements: [] };
    return {
      form: null,
      statements: [
        exactEventFlowPlacementGuard(db, input.event.id, input.purpose, current.placement.id),
        prepareFormPlacementSnapshotGuard(db, current.placement),
        db
          .prepare(
            "UPDATE form_placements SET active = 0, updated_at = ? WHERE id = ? AND active = 1 AND updated_at = ?",
          )
          .bind(input.timestamp, current.placement.id, current.placement.updatedAt),
      ],
    };
  }

  const candidate = await findReusableGroupEventForm(db, input.ownerGroupId, input.formId, input.purpose);
  if (!candidate) throw new AppError(404, "EVENT_FLOW_FORM_NOT_FOUND", "The selected group form is unavailable");
  if (current?.form.id === input.formId) return { form: current, statements: [] };

  const statements: StatementLike[] = [
    exactEventFlowPlacementGuard(db, input.event.id, input.purpose, current?.placement.id ?? null),
    formDefinitionGuard(db, input.ownerGroupId, input.formId, input.purpose),
  ];
  if (current) {
    statements.push(
      prepareFormPlacementSnapshotGuard(db, current.placement),
      db
        .prepare("UPDATE form_placements SET active = 0, updated_at = ? WHERE id = ? AND active = 1 AND updated_at = ?")
        .bind(input.timestamp, current.placement.id, current.placement.updatedAt),
    );
  }
  const existingPlacement = await first<EventFlowFormRow>(
    db,
    `${EVENT_FLOW_FORM_SELECT}
      WHERE placement.form_id = ? AND placement.context_type = 'event' AND placement.context_ref = ?
        AND placement.audience = ? AND placement.active = 0 AND placement.owner_group_id = ?`,
    [input.formId, input.event.id, eventFormAudience(input.purpose), input.ownerGroupId],
  );
  if (existingPlacement) {
    const existing = mapEventFlowForm(existingPlacement).placement;
    statements.push(
      prepareFormPlacementSnapshotGuard(db, existing),
      db
        .prepare("UPDATE form_placements SET active = 1, updated_at = ? WHERE id = ? AND active = 0 AND updated_at = ?")
        .bind(input.timestamp, existing.id, existing.updatedAt),
    );
    return {
      form: { form: candidate, placement: { ...existing, active: true, updatedAt: input.timestamp } },
      statements,
    };
  }
  const placement = prepareFormPlacement(
    db,
    input.formId,
    {
      ownerGroupId: input.ownerGroupId,
      contextType: "event",
      contextRef: input.event.id,
      audience: eventFormAudience(input.purpose),
      active: true,
    },
    input.timestamp,
  );
  statements.push(placement.statement);
  return {
    form: {
      form: candidate,
      placement: {
        id: placement.id,
        formId: input.formId,
        ownerGroupId: input.ownerGroupId,
        contextType: "event",
        contextRef: input.event.id,
        audience: eventFormAudience(input.purpose),
        active: true,
        opensAt: null,
        closesAt: null,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      },
    },
    statements,
  };
}

export function eventFormChangeConflict(error: unknown): AppError | null {
  if (
    isAuthorizationGuardFailure(error) ||
    (error instanceof AppError && error.code === "EVENT_MANAGEMENT_CONTEXT_CHANGED")
  ) {
    return new AppError(409, "EVENT_FLOW_FORM_CHANGED", "The event form changed; reload and retry");
  }
  if (isAuditChangeGuardFailure(error)) {
    return new AppError(409, "EVENT_FLOW_FORM_CHANGED", "The event form changed; reload and retry");
  }
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
    return new AppError(409, "EVENT_FLOW_FORM_CHANGED", "The event form changed; reload and retry");
  }
  return null;
}

export async function replaceGroupEventForm(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  purpose: EventFormsPurpose,
  expectedUpdatedAt: string,
  formId: string | null,
) {
  const { event, ownerGroupId, context } = await requireConfigurableGroupEvent(db, actor, groupIdOrSlug, eventId);
  const timestamp = nowIso();
  const change = await prepareEventFormPlacementChange(db, {
    event,
    context,
    ownerGroupId,
    purpose,
    formId,
    timestamp,
  });
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      eventFlowLifecycleGuard(db, event.id, ownerGroupId),
      ...change.statements,
      db
        .prepare("UPDATE events SET updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(timestamp, event.id, expectedUpdatedAt),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: ownerGroupId },
        "admin",
        actor.id,
        "event_form_placement_updated",
        "event",
        event.id,
        { purpose, formId },
        timestamp,
      ),
    ]);
  } catch (error) {
    throw eventFormChangeConflict(error) ?? error;
  }
  return { eventUpdatedAt: timestamp, purpose, form: change.form };
}

export async function createGroupEventForm(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  purpose: EventFormsPurpose,
  expectedUpdatedAt: string,
  input: Omit<FormDefinitionCreateInput, "purpose">,
) {
  if (input.status !== "active") {
    throw new AppError(400, "EVENT_FLOW_FORM_MUST_BE_ACTIVE", "An event-flow form must be created active");
  }
  const { event, ownerGroupId, context } = await requireConfigurableGroupEvent(db, actor, groupIdOrSlug, eventId);
  if (await findExactEventFlowForm(db, event.id, ownerGroupId, purpose)) {
    throw new AppError(
      409,
      "EVENT_FLOW_FORM_EXISTS",
      `This event already has an active ${eventFormLabel(purpose)} form`,
    );
  }
  const prepared = await prepareManagedForm(
    db,
    actor.id,
    {
      type: "group",
      ref: ownerGroupId,
      groupId: ownerGroupId,
      placement: { contextType: "event", contextRef: event.id, audience: eventFormAudience(purpose) },
    },
    { ...input, purpose },
    { auditScope: { type: "group", id: ownerGroupId }, auditAction: "event_flow_form_created" },
  );
  const timestamp = prepared.updated_at;
  const form: EventFlowFormSummary = {
    placement: {
      id: prepared.placementId,
      formId: prepared.id,
      ownerGroupId,
      contextType: "event",
      contextRef: event.id,
      audience: eventFormAudience(purpose),
      active: true,
      opensAt: null,
      closesAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    form: { id: prepared.id, key: prepared.key, title: input.title, description: input.description ?? null },
  };
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      eventFlowLifecycleGuard(db, event.id, ownerGroupId),
      exactEventFlowPlacementGuard(db, event.id, purpose, null),
      ...prepared.statements,
      db
        .prepare("UPDATE events SET updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(timestamp, event.id, expectedUpdatedAt),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: ownerGroupId },
        "admin",
        actor.id,
        "event_flow_form_attached",
        "event",
        event.id,
        { purpose, formId: prepared.id, placementId: prepared.placementId },
        timestamp,
      ),
    ]);
  } catch (error) {
    throw eventFormChangeConflict(error) ?? error;
  }
  return { eventUpdatedAt: timestamp, purpose, form };
}
