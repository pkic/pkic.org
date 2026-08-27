import {
  eventRegistrationPolicySchema,
  type EventRegistrationPolicy,
} from "../../../../assets/shared/schemas/event-series";
import type { GroupEventRegistrationFormsQuery } from "../../../../assets/shared/schemas/group-events";
import type { FormPlacement } from "../../../../assets/shared/schemas/forms";
import type { FormDefinitionCreateInput } from "../../../../assets/shared/schemas/forms";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import {
  commitEventResourceManagementBatch,
  guardEventResourceManagementDatabase,
  queryEventResourceManagementPage,
  requireEventResourceManagementContext,
  type EventResourceManagementContext,
} from "../event-series/management";
import { EVENT_COLUMNS, type EventRecord } from "../events";
import { prepareManagedForm } from "../forms/management";
import { prepareFormPlacement } from "../forms/placements";

interface RegistrationFormRow {
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
  form_title: string;
  form_description: string | null;
}

interface RegistrationFormSummary {
  placement: FormPlacement;
  form: { id: string; key: string; title: string; description: string | null };
}

type ConfigurableEvent = EventRecord & { updated_at: string };

function mapRegistrationForm(row: RegistrationFormRow): RegistrationFormSummary {
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

const REGISTRATION_FORM_SELECT = `SELECT
  placement.id AS placement_id, placement.form_id, placement.owner_group_id,
  placement.context_type, placement.context_ref, placement.audience,
  placement.active, placement.opens_at, placement.closes_at,
  placement.created_at AS placement_created_at,
  placement.updated_at AS placement_updated_at,
  form.key AS form_key, form.purpose AS form_purpose, form.status AS form_status,
  form.title AS form_title, form.description AS form_description
 FROM form_placements placement
 JOIN forms form ON form.id = placement.form_id`;

async function findExactAttendeeForm(db: DatabaseLike, eventId: string): Promise<RegistrationFormSummary | null> {
  const rows = await db
    .prepare(
      `${REGISTRATION_FORM_SELECT}
        WHERE placement.context_type = 'event'
          AND placement.context_ref = ?
          AND placement.audience = 'attendee'
          AND placement.active = 1
        ORDER BY placement.created_at ASC, placement.id ASC
        LIMIT 2`,
    )
    .bind(eventId)
    .all<RegistrationFormRow>();
  if (rows.results.length > 1) {
    throw new AppError(409, "EVENT_REGISTRATION_FORM_AMBIGUOUS", "Multiple active attendee forms are configured");
  }
  const row = rows.results[0];
  if (!row) return null;
  if (row.form_purpose !== "event_registration" || row.form_status !== "active") {
    throw new AppError(
      409,
      "EVENT_REGISTRATION_FORM_INVALID",
      "The active attendee placement must reference an active event-registration form",
    );
  }
  return mapRegistrationForm(row);
}

async function requireRequiredAttendeeTerms(db: DatabaseLike, eventId: string): Promise<void> {
  const required = await first<{ id: string }>(
    db,
    `SELECT id
       FROM event_terms
      WHERE event_id = ? AND audience_type = 'attendee' AND active = 1 AND required = 1
      LIMIT 1`,
    [eventId],
  );
  if (!required) {
    throw new AppError(422, "EVENT_REGISTRATION_TERMS_REQUIRED", "Registration requires required attendee terms");
  }
}

function eventStandaloneAndTermsGuard(db: DatabaseLike, eventId: string, requiresTerms: boolean): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM events guarded_event
           WHERE guarded_event.id = ?
             AND COALESCE(guarded_event.profile_key, '') NOT IN ('meeting', 'board_meeting')
             AND NOT EXISTS (
               SELECT 1 FROM event_series guarded_series WHERE guarded_series.event_id = guarded_event.id
             )
             ${
               requiresTerms
                 ? `AND EXISTS (
               SELECT 1 FROM event_terms attendee_term
                WHERE attendee_term.event_id = guarded_event.id
                  AND attendee_term.audience_type = 'attendee'
                  AND attendee_term.active = 1
                  AND attendee_term.required = 1
             )`
                 : ""
             }
           LIMIT 1`,
    bindings: [eventId],
  });
}

function formDefinitionGuard(db: DatabaseLike, groupId: string, formId: string): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM forms form
           WHERE form.id = ?
             AND form.purpose = 'event_registration'
             AND form.status = 'active'
             AND form.scope_type = 'community'
             AND form.scope_ref = ?
           LIMIT 1`,
    bindings: [formId, groupId],
  });
}

async function findReusableGroupForm(
  db: DatabaseLike,
  groupId: string,
  formId: string,
): Promise<{ id: string; key: string; title: string; description: string | null } | null> {
  return first(
    db,
    `SELECT form.id, form.key, form.title, form.description
       FROM forms form
      WHERE form.id = ?
        AND form.purpose = 'event_registration'
        AND form.status = 'active'
        AND form.scope_type = 'community'
        AND form.scope_ref = ?`,
    [formId, groupId],
  );
}

function configurableEvent(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
): Promise<{ event: ConfigurableEvent; context: EventResourceManagementContext; guardedDb: DatabaseLike }> {
  return (async () => {
    const event = await first<ConfigurableEvent>(db, `SELECT ${EVENT_COLUMNS}, updated_at FROM events WHERE id = ?`, [
      eventId,
    ]);
    if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    if (event.profile_key === "meeting" || event.profile_key === "board_meeting") {
      throw new AppError(
        409,
        "EVENT_MANAGED_BY_MEETING_SERIES",
        "Meeting events must be configured through their series",
      );
    }
    const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, "manage");
    return { event, context, guardedDb: guardEventResourceManagementDatabase(db, actor, context, "manage") };
  })();
}

export async function getGroupEventRegistrationSettings(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
) {
  const { event, guardedDb } = await configurableEvent(db, actor, groupIdOrSlug, eventId);
  const form = await findExactAttendeeForm(guardedDb, event.id);
  return {
    eventUpdatedAt: event.updated_at,
    registrationPolicy: eventRegistrationPolicySchema.parse(event.registration_mode),
    form,
  };
}

export async function listGroupEventRegistrationForms(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  query: GroupEventRegistrationFormsQuery,
) {
  const { context } = await configurableEvent(db, actor, groupIdOrSlug, eventId);
  const conditions = [
    "form.scope_type = 'community'",
    "form.scope_ref = ?",
    "form.purpose = 'event_registration'",
    "form.status = 'active'",
  ];
  const bindings: unknown[] = [context.groupId];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["form.key", "form.title", "form.description"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const result = await queryEventResourceManagementPage<{
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
  return result;
}

export async function replaceGroupEventRegistrationSettings(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  expectedUpdatedAt: string,
  registrationPolicy: EventRegistrationPolicy,
  formId: string | null | undefined,
) {
  const { event, context } = await configurableEvent(db, actor, groupIdOrSlug, eventId);
  if (registrationPolicy !== "no_registration") await requireRequiredAttendeeTerms(db, event.id);

  const current = await findExactAttendeeForm(db, event.id);
  let selected = current;
  let candidate: { id: string; key: string; title: string; description: string | null } | null = null;
  if (formId !== undefined && formId !== null) {
    candidate = await findReusableGroupForm(db, context.groupId, formId);
    if (!candidate)
      throw new AppError(404, "EVENT_REGISTRATION_FORM_NOT_FOUND", "The selected group form is unavailable");
    selected = {
      form: candidate,
      placement: current?.placement ?? {
        id: "",
        formId,
        ownerGroupId: context.groupId,
        contextType: "event",
        contextRef: event.id,
        audience: "attendee",
        active: true,
        opensAt: null,
        closesAt: null,
        createdAt: "",
        updatedAt: "",
      },
    };
  } else if (formId === null) {
    selected = null;
  }

  const now = new Date().toISOString();
  const statements: StatementLike[] = [
    eventStandaloneAndTermsGuard(db, event.id, registrationPolicy !== "no_registration"),
  ];
  if (formId !== undefined && formId !== null) {
    statements.push(formDefinitionGuard(db, context.groupId, formId));
  }
  if (current && (formId === null || (formId !== undefined && current.form.id !== formId))) {
    statements.push(
      db
        .prepare("UPDATE form_placements SET active = 0, updated_at = ? WHERE id = ? AND active = 1")
        .bind(now, current.placement.id),
    );
  }
  if (formId !== undefined && formId !== null && (!current || current.form.id !== formId)) {
    const existingPlacement = await first<{ id: string }>(
      db,
      `SELECT id FROM form_placements
        WHERE form_id = ? AND context_type = 'event' AND context_ref = ?
          AND audience = 'attendee'`,
      [formId, event.id],
    );
    if (existingPlacement) {
      statements.push(
        db
          .prepare("UPDATE form_placements SET active = 1, owner_group_id = ?, updated_at = ? WHERE id = ?")
          .bind(context.groupId, now, existingPlacement.id),
      );
      selected = { form: candidate!, placement: { ...selected!.placement, id: existingPlacement.id } };
    } else {
      const placement = prepareFormPlacement(
        db,
        formId,
        {
          ownerGroupId: context.groupId,
          contextType: "event",
          contextRef: event.id,
          audience: "attendee",
          active: true,
        },
        now,
      );
      statements.push(placement.statement);
      selected = {
        form: candidate!,
        placement: { ...selected!.placement, id: placement.id, createdAt: now, updatedAt: now },
      };
    }
  }
  const updatedAt = now;
  statements.push(
    db
      .prepare("UPDATE events SET registration_mode = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
      .bind(registrationPolicy, updatedAt, event.id, expectedUpdatedAt),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "group", id: context.groupId },
      "admin",
      actor.id,
      "event_registration_settings_updated",
      "event",
      event.id,
      { registrationPolicy, formId: formId === undefined ? (current?.form.id ?? null) : formId },
      updatedAt,
    ),
  );

  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", statements);
  } catch (error) {
    if (
      isAuthorizationGuardFailure(error) ||
      (error instanceof AppError && error.code === "EVENT_MANAGEMENT_CONTEXT_CHANGED")
    ) {
      throw new AppError(
        409,
        "EVENT_REGISTRATION_SETTINGS_CHANGED",
        "Event registration settings changed; reload and retry",
      );
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "EVENT_REGISTRATION_SETTINGS_CHANGED",
        "Event registration settings changed; reload and retry",
      );
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new AppError(409, "EVENT_REGISTRATION_FORM_CHANGED", "The attendee form changed; reload and retry");
    }
    throw error;
  }

  return {
    eventUpdatedAt: updatedAt,
    registrationPolicy,
    form: selected,
  };
}

/** Creates a group-owned reusable attendee form and exact event placement as one event command. */
export async function createGroupEventRegistrationForm(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  input: FormDefinitionCreateInput,
) {
  const { event, context } = await configurableEvent(db, actor, groupIdOrSlug, eventId);
  if (input.status !== "active") {
    throw new AppError(400, "EVENT_REGISTRATION_FORM_MUST_BE_ACTIVE", "An attendee form must be created active");
  }
  const current = await findExactAttendeeForm(db, event.id);
  if (current) {
    throw new AppError(409, "EVENT_REGISTRATION_FORM_EXISTS", "This event already has an active attendee form");
  }
  const prepared = await prepareManagedForm(
    db,
    actor.id,
    {
      type: "group",
      ref: context.groupId,
      groupId: context.groupId,
      placement: { contextType: "event", contextRef: event.id, audience: "attendee" },
    },
    input,
    { auditScope: { type: "group", id: context.groupId }, auditAction: "event_registration_form_created" },
  );
  const now = prepared.updated_at;
  const placement: FormPlacement = {
    id: prepared.placementId,
    formId: prepared.id,
    ownerGroupId: context.groupId,
    contextType: "event",
    contextRef: event.id,
    audience: "attendee",
    active: true,
    opensAt: null,
    closesAt: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      eventStandaloneAndTermsGuard(db, event.id, false),
      ...prepared.statements,
      db
        .prepare("UPDATE events SET updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(now, event.id, event.updated_at),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: context.groupId },
        "admin",
        actor.id,
        "event_registration_form_attached",
        "event",
        event.id,
        { formId: prepared.id, placementId: prepared.placementId },
        now,
      ),
    ]);
  } catch (error) {
    if (
      isAuthorizationGuardFailure(error) ||
      (error instanceof AppError && error.code === "EVENT_MANAGEMENT_CONTEXT_CHANGED")
    ) {
      throw new AppError(409, "EVENT_REGISTRATION_SETTINGS_CHANGED", "Event settings changed; reload and retry");
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_REGISTRATION_SETTINGS_CHANGED", "Event settings changed; reload and retry");
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new AppError(409, "EVENT_REGISTRATION_FORM_EXISTS", "This event already has an attendee form");
    }
    throw error;
  }
  return {
    eventUpdatedAt: now,
    registrationPolicy: eventRegistrationPolicySchema.parse(event.registration_mode),
    form: {
      placement,
      form: { id: prepared.id, key: prepared.key, title: input.title, description: input.description ?? null },
    },
  };
}
