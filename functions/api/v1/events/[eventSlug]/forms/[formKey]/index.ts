import {
  formDeleteResponseSchema,
  formDetailResponseSchema,
  formUpdateResponseSchema,
} from "../../../../../../../assets/shared/schemas/form-management";
import {
  eventFormDeleteRouteSchema,
  eventFormGetRouteSchema,
  eventFormPatchRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-forms";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../../../../../_lib/db/authorization-guard";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { mapManagedFormFields, removeManagedForm, updateManagedForm } from "../../../../../../_lib/services/forms";
import { guardedEventFormsDatabase, requireEventForm, requireEventFormsPermission } from "../authorization";

function prepareEventOwnedFormGuard(db: ReturnType<typeof guardedEventFormsDatabase>, eventId: string, formId: string) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM forms form
            JOIN events event ON event.id = form.scope_ref
           WHERE form.id = ?
             AND form.scope_type = 'event'
             AND form.scope_ref = ?
             AND (
               form.purpose NOT IN ('event_registration', 'proposal_submission')
               OR COALESCE(event.source_mode, '') <> 'portal'
             )
           LIMIT 1`,
    bindings: [formId, eventId],
  });
}

function rejectPortalEventFlowForm(event: { source_mode?: string | null }, form: { purpose: string }) {
  if (
    event.source_mode === "portal" &&
    (form.purpose === "event_registration" || form.purpose === "proposal_submission")
  ) {
    throw new AppError(
      403,
      "PORTAL_EVENT_FORMS_OWNED_BY_GROUP",
      "Event-flow forms for portal-owned events must be managed from the owning group",
    );
  }
}

export const EventFormGet = openApiRoute(eventFormGetRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventFormsPermission(c, data.params.eventSlug, "events:read");
  const aggregate = await requireEventForm(db, event.id, data.params.formKey);
  return json(
    formDetailResponseSchema.parse({
      form: aggregate.form,
      fields: mapManagedFormFields(aggregate.fields),
    }),
  );
});

export const EventFormPatch = openApiRoute(eventFormPatchRouteSchema, async (c: AdminContext, data) => {
  const { actor, context, db, event } = await requireEventFormsPermission(c, data.params.eventSlug, "events:write");
  const aggregate = await requireEventForm(db, event.id, data.params.formKey, { ownedOnly: true });
  rejectPortalEventFlowForm(event, aggregate.form);
  const guardedDb = guardedEventFormsDatabase(db, actor, context);
  try {
    await updateManagedForm(guardedDb, actor.id, aggregate.form, data.body, {
      authorizationGuards: [prepareEventOwnedFormGuard(guardedDb, event.id, aggregate.form.id)],
      auditScope: { type: "event", id: event.id },
      auditAction: "event_form_updated",
    });
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "EVENT_FORM_CONTEXT_CHANGED", "The event form ownership changed; reload and retry");
    }
    throw error;
  }
  const updated = await requireEventForm(db, event.id, data.params.formKey, { ownedOnly: true });
  return json(
    formUpdateResponseSchema.parse({
      success: true,
      form: updated.form,
      fields: mapManagedFormFields(updated.fields),
    }),
  );
});

export const EventFormDelete = openApiRoute(eventFormDeleteRouteSchema, async (c: AdminContext, data) => {
  const { actor, context, db, event } = await requireEventFormsPermission(c, data.params.eventSlug, "events:write");
  const aggregate = await requireEventForm(db, event.id, data.params.formKey, { ownedOnly: true });
  rejectPortalEventFlowForm(event, aggregate.form);
  const guardedDb = guardedEventFormsDatabase(db, actor, context);
  try {
    const action = await removeManagedForm(guardedDb, actor.id, aggregate.form, {
      authorizationGuards: [prepareEventOwnedFormGuard(guardedDb, event.id, aggregate.form.id)],
      auditScope: { type: "event", id: event.id },
    });
    return json(
      formDeleteResponseSchema.parse({
        action,
        ...(action === "archived" ? { message: "Form archived — submissions preserved." } : {}),
      }),
    );
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "EVENT_FORM_CONTEXT_CHANGED", "The event form ownership changed; reload and retry");
    }
    throw error;
  }
});
