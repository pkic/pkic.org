import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getCsvExportLimits } from "../../../../../../_lib/config";
import { csvResponse } from "../../../../../../_lib/csv";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { getActiveFormByPurpose } from "../../../../../../_lib/services/forms";
import { buildAdminRegistrationCsv } from "../../../../../../_lib/services/registrations/admin-export";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, c.req.param("eventSlug"));
  const registrationForm = await getActiveFormByPurpose(db, event.id, "event_registration");
  const result = await buildAdminRegistrationCsv(db, event.id, registrationForm?.fields, getCsvExportLimits(c.env));
  await writeAuditLog(db, "admin", admin.id, "admin_registration_export", "event", event.id, {
    recordCount: result.recordCount,
  });
  return csvResponse(result.csv, `${event.slug}-attendees.csv`);
}
