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

async function listTerms(db: DatabaseLike, eventId: string): Promise<{ attendee: TermRow[]; speaker: TermRow[] }> {
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
  };
}

export async function onRequestGet(
  c: any,
): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const terms = await listTerms(c.env.DB, event.id);
  return json({ terms });
}

export async function onRequestPut(
  c: any,
): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventTermsReplaceSchema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));

  // Replace attendee terms preserving help_text (not in the base replaceEventTerms service)
  for (const audienceType of ["attendee", "speaker"] as const) {
    const termList = audienceType === "attendee" ? body.attendee : body.speaker;

    await run(
      c.env.DB,
      "UPDATE event_terms SET active = 0 WHERE event_id = ? AND audience_type = ?",
      [event.id, audienceType],
    );

    const now = nowIso();
    for (const term of termList) {
      await run(
        c.env.DB,
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

  await writeAuditLog(
    c.env.DB,
    "admin",
    admin.id,
    "event_terms_replaced",
    "event",
    event.id,
    { attendeeCount: body.attendee.length, speakerCount: body.speaker.length },
  );

  const updatedTerms = await listTerms(c.env.DB, event.id);
  return json({ success: true, terms: updatedTerms });
}

export async function onRequest(
  c: any,
): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PUT") return onRequestPut(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
