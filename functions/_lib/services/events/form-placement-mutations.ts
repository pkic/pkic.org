/**
 * Changing an event's form: which one is placed, and when it accepts
 * responses.
 *
 * Split from `form-placement.ts`, which had grown to hold both how an event's
 * form is RESOLVED — the exact-placement query, its ambiguity and ownership
 * refusals, the guards those rest on — and every way it is CHANGED. Those are
 * two responsibilities: one is read by every surface that renders an event
 * flow, the other only by the handful that configure one.
 *
 * Every mutation here goes through the same guarded batch and the same
 * optimistic event revision, so two people configuring one event cannot
 * silently overwrite each other.
 */
import type { FormDefinitionCreateInput, EventFormsPurpose } from "../../../../assets/shared/schemas/forms";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLogAfterOneChange } from "../audit";
import { commitEventResourceManagementBatch } from "../event-series/management";
import { prepareManagedForm } from "../forms/management";
import {
  eventFlowLifecycleGuard,
  eventFormAudience,
  eventFormChangeConflict,
  eventFormLabel,
  exactEventFlowPlacementGuard,
  findExactEventFlowForm,
  prepareEventFormPlacementChange,
  requireConfigurableGroupEvent,
  type EventFlowFormSummary,
} from "./form-placement";

/**
 * Sets the window an event's placed form accepts responses in (#38).
 *
 * The window lives on the placement rather than on the definition: one
 * reusable form can be placed in two events whose registration opens and
 * closes on different days, and a window on the definition would be one
 * event overwriting the other's dates.
 *
 * Written through the same guarded batch and the same optimistic event
 * revision the form selection uses, so two people configuring one event's
 * registration cannot silently overwrite each other — and so a window cannot
 * be set on an event whose ownership changed underneath the request.
 */
export async function updateGroupEventFormPlacementWindow(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  purpose: EventFormsPurpose,
  expectedUpdatedAt: string,
  input: { opensAt?: string | null; closesAt?: string | null; active?: boolean },
) {
  const { event, ownerGroupId, context, guardedDb } = await requireConfigurableGroupEvent(
    db,
    actor,
    groupIdOrSlug,
    eventId,
  );
  const placed = await findExactEventFlowForm(guardedDb, event.id, ownerGroupId, purpose);
  if (!placed) {
    throw new AppError(
      404,
      "EVENT_FLOW_FORM_NOT_PLACED",
      `No ${eventFormLabel(purpose)} form is placed for this event`,
    );
  }

  /*
   * Both ends are checked together against what the placement will actually
   * hold, not against what this request happens to name: clearing an opening
   * time while leaving a closing time is a valid window, and changing only
   * the close still has to land after the open already stored.
   */
  const opensAt = input.opensAt === undefined ? placed.placement.opensAt : input.opensAt;
  const closesAt = input.closesAt === undefined ? placed.placement.closesAt : input.closesAt;
  if (opensAt && closesAt && opensAt >= closesAt) {
    throw new AppError(422, "FORM_WINDOW_INVALID", "Closing time must be after opening time");
  }

  const timestamp = nowIso();
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      eventFlowLifecycleGuard(db, event.id, ownerGroupId),
      db
        .prepare(
          `UPDATE form_placements
              SET opens_at = ?, closes_at = ?, active = ?, updated_at = ?
            WHERE id = ? AND updated_at = ?`,
        )
        .bind(
          opensAt,
          closesAt,
          (input.active ?? placed.placement.active) ? 1 : 0,
          timestamp,
          placed.placement.id,
          placed.placement.updatedAt,
        ),
      db
        .prepare("UPDATE events SET updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(timestamp, event.id, expectedUpdatedAt),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: ownerGroupId },
        "admin",
        actor.id,
        "event_form_window_updated",
        "event",
        event.id,
        { purpose, placementId: placed.placement.id, opensAt, closesAt },
        timestamp,
      ),
    ]);
  } catch (error) {
    throw eventFormChangeConflict(error) ?? error;
  }

  return {
    eventUpdatedAt: timestamp,
    purpose,
    form: await findExactEventFlowForm(guardedDb, event.id, ownerGroupId, purpose),
  };
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
