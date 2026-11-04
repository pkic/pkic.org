import { loadRegistrationDayStates } from "./day-states";
import { registrationPopulationFilter } from "./registration-population-filter";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import type { GroupEventRegistrationExportQuery } from "../../../../assets/shared/schemas/group-event-registration-operations";
import { REGISTRATION_ORGANIZATION_SQL, REGISTRATION_JOB_TITLE_SQL } from "./selected-identity";
import { encodeBoundedCsv } from "../../csv";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { formatCustomAnswerValue } from "../../utils/custom-answer-display";
import { prepareStateGuard, isStateGuardFailure } from "../../db/authorization-guard";
import { prepareAuditLog, writeAuditLog } from "../audit";
import { resolveEventFormResponses, type EventFormResponse, type EventFormResolutionEvent } from "../forms";
import type { FormFieldDefinition } from "../forms";
import { sponsorConsentSql } from "../event-participation/sponsor-consent";
import { contactAffiliation } from "../../email-domains/contact-kind";
import { PERSONAL_EMAIL_ADDRESS_LABEL } from "../../../../assets/shared/email-first-copy";

interface ExportRow {
  id: string;
  user_id: string;
  status: string;
  source_type: string | null;
  created_at: string;
  user_email: string | null;
  display_name: string | null;
  organization: string | null;
  job_title: string | null;
  sponsor_consent: number;
  custom_answers_json: string | null;
  form_placement_id: string | null;
}

interface ExportFormColumn {
  id: string;
  label: string;
  formId: string;
  formKey: string;
  field: FormFieldDefinition;
}

function exportFormColumns(responses: Iterable<EventFormResponse | null>): ExportFormColumn[] {
  const entries = [...responses];
  const columns: ExportFormColumn[] = [];
  const seen = new Set<string>();
  for (const response of entries) {
    if (!response?.form) continue;
    for (const field of response.form.fields) {
      const id = `${response.form.id}:${field.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      columns.push({ id, label: field.label, formId: response.form.id, formKey: response.form.key, field });
    }
  }
  const labelCounts = new Map<string, number>();
  for (const column of columns) labelCounts.set(column.label, (labelCounts.get(column.label) ?? 0) + 1);
  const usedLabels = new Set<string>();
  return columns.map((column) => {
    const preferred = (labelCounts.get(column.label) ?? 0) > 1 ? `${column.formKey}: ${column.label}` : column.label;
    const identity = `${column.formKey}:${column.field.key}`;
    let label = preferred;
    if (usedLabels.has(label)) label = `${preferred} (${identity})`;
    let suffix = 2;
    while (usedLabels.has(label)) {
      label = `${preferred} (${identity} ${suffix})`;
      suffix += 1;
    }
    usedLabels.add(label);
    return { ...column, label };
  });
}

export async function buildRegistrationCsv(
  db: DatabaseLike,
  event: EventFormResolutionEvent,
  limits: { maxRows: number; maxBytes: number },
  query?: GroupEventRegistrationExportQuery,
): Promise<{ csv: string; recordCount: number; releaseGuards?: StatementLike[] }> {
  const population = registrationPopulationFilter(event.id, query ?? {});
  const selected = query?.ids ? buildD1JsonMembershipFilter("r.id", query.ids) : null;
  const rows = await all<ExportRow>(
    db,
    `SELECT r.id, r.user_id, r.status, r.source_type, r.created_at,
            u.email AS user_email,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
            ${REGISTRATION_ORGANIZATION_SQL} AS organization,
            ${REGISTRATION_JOB_TITLE_SQL} AS job_title,
            ${sponsorConsentSql("r")} AS sponsor_consent,
            r.custom_answers_json, r.form_placement_id
     ${population.fromSql}
       ${query?.audience === "sponsor" ? `AND ${sponsorConsentSql("r")}` : ""}
       ${query ? "" : "AND r.status IN ('registered', 'pending_email_confirmation')"}
       ${selected ? `AND ${selected.sql}` : ""}
     ORDER BY r.status ASC, r.created_at ASC
     LIMIT ?`,
    [...population.bindings, ...(selected?.bindings ?? []), limits.maxRows + 1],
  );
  if (rows.length > limits.maxRows) {
    throw new AppError(413, "CSV_EXPORT_ROW_LIMIT_EXCEEDED", `CSV export is limited to ${limits.maxRows} records`);
  }

  if (query?.audience === "sponsor") {
    // Sponsor files deliberately omit organizer-only answers and registration metadata.
    return {
      csv: encodeBoundedCsv(
        [
          ["Name", "Email", "Organization", "Job title"],
          ...rows.map((row) => [row.display_name, row.user_email, row.organization, row.job_title]),
        ],
        limits.maxBytes,
      ),
      recordCount: rows.length,
      releaseGuards: Array.from({ length: Math.ceil(rows.length / 500) }, (_, index) =>
        prepareStateGuard(db, {
          sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) expected
            LEFT JOIN registrations r ON r.id=json_extract(expected.value,'$.id')
              AND r.user_id=json_extract(expected.value,'$.userId') AND r.event_id=?
            WHERE r.id IS NULL OR NOT ${sponsorConsentSql("r")})`,
          bindings: [
            JSON.stringify(
              rows.slice(index * 500, (index + 1) * 500).map((row) => ({ id: row.id, userId: row.user_id })),
            ),
            event.id,
          ],
        }),
      ),
    };
  }

  const [responseByRegistration, dayStates] = await Promise.all([
    resolveEventFormResponses(
      db,
      rows.map((row) => ({
        source: "registration" as const,
        sourceId: row.id,
        event,
        formPlacementId: row.form_placement_id,
        answersJson: row.custom_answers_json,
      })),
    ),
    loadRegistrationDayStates(
      db,
      rows.map((row) => row.id),
    ),
  ]);
  const formColumns = exportFormColumns(rows.map((row) => responseByRegistration.get(row.id) ?? null));
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
    ...formColumns.map((column) => column.label),
  ];
  const dataRows = rows.map((row) => {
    const response = responseByRegistration.get(row.id) ?? null;
    const customAnswers = response ? response.answers : null;
    const affiliation = contactAffiliation(row.user_email, row.organization);
    const selectedDays = dayStates.get(row.id) ?? [];
    const attendance = selectedDays
      .map((day) => {
        const status =
          day.waitlistStatus === "waiting"
            ? " (waitlisted)"
            : day.waitlistStatus === "offered"
              ? " (place offered)"
              : day.waitlistStatus === "expired"
                ? " (offer expired)"
                : "";
        return `${day.dayDate}: ${day.optionLabel ?? day.attendanceType}${status}`;
      })
      .join("; ");
    return [
      row.id,
      row.display_name,
      row.user_email,
      affiliation.personalEmail ? PERSONAL_EMAIL_ADDRESS_LABEL : affiliation.organization,
      row.job_title,
      row.status,
      attendance,
      row.source_type,
      row.created_at,
      row.sponsor_consent ? "Yes" : "No",
      ...formColumns.map((column) =>
        response?.form?.id === column.formId
          ? formatCustomAnswerValue(customAnswers?.[column.field.key], column.field)
          : "",
      ),
    ];
  });
  return { csv: encodeBoundedCsv([header, ...dataRows], limits.maxBytes), recordCount: rows.length };
}

export async function buildRegistrationCsvWithAudit(
  db: DatabaseLike,
  event: EventFormResolutionEvent,
  actorUserId: string,
  limits: { maxRows: number; maxBytes: number },
  query?: GroupEventRegistrationExportQuery,
): Promise<{ csv: string; recordCount: number }> {
  const result = await buildRegistrationCsv(db, event, limits, query);
  if (query?.audience === "sponsor") {
    try {
      await db.batch([
        ...(result.releaseGuards ?? []),
        prepareAuditLog(db, "admin", actorUserId, "admin_registration_export", "event", event.id, {
          recordCount: result.recordCount,
          audience: "sponsor",
        }),
      ]);
    } catch (error) {
      if (isStateGuardFailure(error))
        throw new AppError(409, "SPONSOR_CONSENT_CHANGED", "Sponsor sharing consent changed. Download the list again.");
      throw error;
    }
    return { csv: result.csv, recordCount: result.recordCount };
  }
  await writeAuditLog(db, "admin", actorUserId, "admin_registration_export", "event", event.id, {
    recordCount: result.recordCount,
  });
  return result;
}
