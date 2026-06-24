/**
 * GET  /api/v1/admin/events/:eventSlug/terms
 *   Returns all active terms for the event, grouped by audience type.
 *
 * PUT  /api/v1/admin/events/:eventSlug/terms
 *   Replaces all attendee and speaker terms for the event.
 *   Deactivates existing terms, then upserts the submitted set.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { uuid } from "../../../../../_lib/utils/ids";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import type { DatabaseLike } from "../../../../../_lib/types";
import { adminEventTermsReplaceSchema } from "../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

interface TermRow {
  id: string;
  audience_type: string;
  term_key: string;
  version: string;
  required: number;
  content_ref: string | null;
  display_text: string | null;
  help_text: string | null;
  active: number;
}

async function listTerms(
  db: DatabaseLike,
  eventId: string,
): Promise<{ attendee: TermRow[]; speaker: TermRow[]; presentation: TermRow[] }> {
  const rows = await all<TermRow>(
    db,
    `SELECT id, audience_type, term_key, version, required, content_ref, display_text, help_text, active
     FROM event_terms
     WHERE event_id = ? AND active = 1
     ORDER BY audience_type ASC, rowid ASC`,
    [eventId],
  );
  return {
    attendee: rows.filter((r) => r.audience_type === "attendee"),
    speaker: rows.filter((r) => r.audience_type === "speaker"),
    presentation: rows.filter((r) => r.audience_type === "presentation"),
  };
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const terms = await listTerms(requestDb(c), event.id);
  return json({ terms });
}

export async function onRequestPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventTermsReplaceSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  // Replace attendee terms preserving help_text (not in the base replaceEventTerms service)
  for (const audienceType of ["attendee", "speaker", "presentation"] as const) {
    const termList = audienceType === "attendee" ? body.attendee : audienceType === "speaker" ? body.speaker : body.presentation;

    await run(requestDb(c), "UPDATE event_terms SET active = 0 WHERE event_id = ? AND audience_type = ?", [
      event.id,
      audienceType,
    ]);

    const now = nowIso();
    for (const term of termList) {
      await run(
        requestDb(c),
        `INSERT INTO event_terms (
          id, event_id, audience_type, term_key, version, required, content_ref, display_text, help_text, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(event_id, audience_type, term_key, version)
        DO UPDATE SET
          required = excluded.required,
          content_ref = excluded.content_ref,
          display_text = excluded.display_text,
          help_text = excluded.help_text,
          active = 1`,
        [
          uuid(),
          event.id,
          audienceType,
          term.termKey,
          term.version,
          term.required ? 1 : 0,
          term.contentRef ?? null,
          term.displayText ?? null,
          term.helpText ?? null,
          now,
        ],
      );
    }
  }

  await writeAuditLog(requestDb(c), "admin", admin.id, "event_terms_replaced", "event", event.id, {
    attendeeCount: body.attendee.length,
    speakerCount: body.speaker.length,
    presentationCount: body.presentation.length,
  });

  const updatedTerms = await listTerms(requestDb(c), event.id);
  return json({ success: true, terms: updatedTerms });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PUT") return onRequestPut(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
