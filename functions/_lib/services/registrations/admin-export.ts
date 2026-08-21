import type { FormFieldDefinition } from "../forms";
import { encodeBoundedCsv } from "../../csv";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { extractDietarySelections } from "../../utils/registration-dietary";
import { writeAuditLog } from "../audit";

interface ExportRow {
  id: string;
  status: string;
  attendance_type: string | null;
  source_type: string | null;
  created_at: string;
  user_email: string | null;
  display_name: string | null;
  organization: string | null;
  job_title: string | null;
  sponsor_consent: number;
  custom_answers_json: string | null;
}

export async function buildAdminRegistrationCsv(
  db: DatabaseLike,
  eventId: string,
  formFields: FormFieldDefinition[] | null | undefined,
  limits: { maxRows: number; maxBytes: number },
): Promise<{ csv: string; recordCount: number }> {
  const rows = await all<ExportRow>(
    db,
    `SELECT r.id, r.status, r.attendance_type, r.source_type, r.created_at,
            u.email AS user_email,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
            u.organization_name AS organization,
            u.job_title,
            EXISTS(SELECT 1 FROM consent_acceptances ca
                   WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing') AS sponsor_consent,
            r.custom_answers_json
     FROM registrations r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.event_id = ?
       AND r.status IN ('registered', 'pending_email_confirmation')
     ORDER BY r.status ASC, r.created_at ASC
     LIMIT ?`,
    [eventId, limits.maxRows + 1],
  );
  if (rows.length > limits.maxRows) {
    throw new AppError(413, "CSV_EXPORT_ROW_LIMIT_EXCEEDED", `CSV export is limited to ${limits.maxRows} records`);
  }

  const header = [
    "ID",
    "Name",
    "Email",
    "Organization",
    "Job title",
    "Status",
    "Attendance",
    "Source",
    "Registered at",
    "Sponsor consent",
    "Dietary requirements",
  ];
  const dataRows = rows.map((row) => {
    const dietary = extractDietarySelections(
      parseJsonSafe<Record<string, unknown> | null>(row.custom_answers_json, null),
      formFields,
    ).join("; ");
    return [
      row.id,
      row.display_name,
      row.user_email,
      row.organization,
      row.job_title,
      row.status,
      row.attendance_type,
      row.source_type,
      row.created_at,
      row.sponsor_consent ? "Yes" : "No",
      dietary,
    ];
  });
  return { csv: encodeBoundedCsv([header, ...dataRows], limits.maxBytes), recordCount: rows.length };
}

export async function buildAdminRegistrationCsvWithAudit(
  db: DatabaseLike,
  eventId: string,
  actorUserId: string,
  formFields: FormFieldDefinition[] | null | undefined,
  limits: { maxRows: number; maxBytes: number },
): Promise<{ csv: string; recordCount: number }> {
  const result = await buildAdminRegistrationCsv(db, eventId, formFields, limits);
  await writeAuditLog(db, "admin", actorUserId, "admin_registration_export", "event", eventId, {
    recordCount: result.recordCount,
  });
  return result;
}
