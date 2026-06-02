import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { all } from "../../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

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
  dietary_restrictions: string | null;
}

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  const rows = await all<ExportRow>(
    requestDb(c),
    `SELECT r.id, r.status, r.attendance_type, r.source_type, r.created_at,
            u.email AS user_email,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
            u.organization_name AS organization,
            u.job_title,
            EXISTS(SELECT 1 FROM consent_acceptances ca
                   WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing') AS sponsor_consent,
            JSON_EXTRACT(r.custom_answers_json, '$.dietary_restrictions') AS dietary_restrictions
     FROM registrations r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.event_id = ?
       AND r.status IN ('registered', 'waitlisted', 'pending_email_confirmation')
     ORDER BY r.status ASC, r.created_at ASC`,
    [event.id],
  );

  const headers = [
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

  const lines = [
    toCsvRow(headers),
    ...rows.map((r) => {
      const dietary = r.dietary_restrictions ? (JSON.parse(r.dietary_restrictions) as string[]).join("; ") : "";
      return toCsvRow([
        r.id,
        r.display_name,
        r.user_email,
        r.organization,
        r.job_title,
        r.status,
        r.attendance_type,
        r.source_type,
        r.created_at,
        r.sponsor_consent ? "Yes" : "No",
        dietary,
      ]);
    }),
  ];

  const filename = `${event.slug}-attendees.csv`;
  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
