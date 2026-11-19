import type { FormDetailResponse } from "../../../../assets/shared/schemas/form-management";
import { requirePermission } from "../../auth/permissions";
import type { DatabaseLike, Env } from "../../types";
import { mapManagedFormFields, prepareFormOptionCatalogs, prepareManagedEventForm } from "../forms/read";
import { prepareEventAdminContext, readEventAdminContext } from "./authorized-context";

/** Live human context, event relationship, and form definition share one read snapshot. */
export async function getEventFormDetail(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  formKey: string,
): Promise<FormDetailResponse> {
  const context = await prepareEventAdminContext(db, request, env, eventSlug);
  const form = prepareManagedEventForm(db, { slug: eventSlug }, formKey);
  // Inactive and archived choices stay labeled, so historical responses remain filterable.
  const catalogs = prepareFormOptionCatalogs(db, "SELECT id FROM forms WHERE key = ?", [formKey], {
    includeArchived: true,
    includeInactive: true,
  });
  const fallback = context ? null : await readEventAdminContext(db, request, env, eventSlug);
  const results = await db.batch([...(context?.statements ?? []), ...form.statements, ...catalogs.statements]);
  const { actor, event } = context ? await context.decode(results.slice(0, context.statements.length)) : fallback!;
  requirePermission(actor, "events:read", { type: "event", id: event.id });
  const formResults = results.slice(context?.statements.length ?? 0);
  const aggregate = form.decode(formResults);
  const fields = mapManagedFormFields(aggregate.fields, catalogs.decode(formResults.slice(form.statements.length)));
  return { form: aggregate.form, fields };
}
