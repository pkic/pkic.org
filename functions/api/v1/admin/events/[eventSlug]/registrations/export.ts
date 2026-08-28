import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getCsvExportLimits } from "../../../../../../_lib/config";
import { csvResponse } from "../../../../../../_lib/csv";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { getActiveFormForEvent, toEventFormResolutionEvent } from "../../../../../../_lib/services/forms";
import { buildAdminRegistrationCsvWithAudit } from "../../../../../../_lib/services/registrations/admin-export";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, c.req.param("eventSlug"));
  const registrationForm = await getActiveFormForEvent(
    db,
    toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
    "event_registration",
  );
  const result = await buildAdminRegistrationCsvWithAudit(
    db,
    event.id,
    admin.id,
    registrationForm?.fields,
    getCsvExportLimits(c.env),
  );
  return csvResponse(result.csv, `${event.slug}-attendees.csv`);
}
