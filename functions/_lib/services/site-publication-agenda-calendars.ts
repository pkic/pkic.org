import { storedAgendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda-stored";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";
import { type AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import { eventVisibilitySchema } from "../../../assets/shared/schemas/event-series";
import { utcInstantSchema } from "../../../assets/shared/schemas/api-common";
import type { PublicAgendaCalendar } from "../../../assets/shared/schemas/site-agenda-calendar";
import { createPublicAgendaCalendarProjection } from "./site-agenda-calendar-projection";

const APPROVAL_HISTORY_BUILD_LIMIT = 10000;
type VisibilityTransition = { event_id: string; id: string; created_at: string; visibility: string };
/** Existing authorized settings writes audit visibility explicitly; only their minimal transition crosses this read boundary. */
async function visibilityHistory(db: DatabaseLike) {
  const result = new Map<string, VisibilityTransition[]>();
  let afterEvent = "",
    afterAt = "",
    afterId = "";
  let count = 0;
  for (;;) {
    const page = await all<VisibilityTransition>(
      db,
      `SELECT audit.entity_id AS event_id,audit.id,audit.created_at,json_extract(audit.details_json,'$.visibility.to') AS visibility
       FROM audit_log audit JOIN event_agenda_state state ON state.event_id=audit.entity_id AND state.published_revision IS NOT NULL
       WHERE audit.entity_type='event' AND audit.action='event_settings_updated' AND json_type(audit.details_json,'$.visibility.to')='text'
       AND (audit.entity_id>? OR (audit.entity_id=? AND (audit.created_at>? OR (audit.created_at=? AND audit.id>?))))
       ORDER BY audit.entity_id,audit.created_at,audit.id LIMIT 100`,
      [afterEvent, afterEvent, afterAt, afterAt, afterId],
    );
    if (!page.length) break;
    count += page.length;
    if (count > APPROVAL_HISTORY_BUILD_LIMIT) throw new Error("PUBLIC_CALENDAR_HISTORY_BUDGET_EXCEEDED");
    for (const row of page) {
      utcInstantSchema.parse(row.created_at);
      if (!eventVisibilitySchema.safeParse(row.visibility).success) continue;
      const rows = result.get(row.event_id) ?? [];
      rows.push(row);
      result.set(row.event_id, rows);
    }
    const last = page[page.length - 1]!;
    afterEvent = last.event_id;
    afterAt = last.created_at;
    afterId = last.id;
  }
  return result;
}
/** Native build-only history: bounded pages and a fail-closed total budget, never a clipped sequence. */
export async function readPublicAgendaCalendars(
  db: DatabaseLike,
  now: string,
): Promise<Record<string, PublicAgendaCalendar>> {
  const transitions = await visibilityHistory(db);
  const result: Record<string, PublicAgendaCalendar> = {};
  const paths = new Set<string>();
  let afterEvent = "",
    afterRevision = -1,
    count = 0;
  let approvals: AgendaSnapshot[] = [];
  let owner: { eventId: string; slug: string; currentPublic: boolean; agendaPath: string } | undefined;
  const finish = () => {
    if (!owner) return;
    const fold = createPublicAgendaCalendarProjection(now);
    const history = (transitions.get(owner.eventId) ?? []).filter((row) => row.created_at >= approvals[0]!.approvedAt!);
    // UUID audit IDs do not establish order between conflicting same-instant transitions.
    const firstVisibility = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const row of history) {
      if (firstVisibility.has(row.created_at) && firstVisibility.get(row.created_at) !== row.visibility)
        ambiguous.add(row.created_at);
      else firstVisibility.set(row.created_at, row.visibility);
    }
    let index = 0;
    for (const snapshot of approvals) {
      while (index < history.length && history[index]!.created_at < snapshot.approvedAt!) {
        const transition = history[index++]!;
        if (!ambiguous.has(transition.created_at))
          fold.visibility(transition.visibility === "public", transition.created_at);
      }
      fold.append(snapshot);
      // The approval's same-batch marker resolves same-instant visibility ordering.
      while (index < history.length && history[index]!.created_at === snapshot.approvedAt) index++;
    }
    while (index < history.length) {
      const transition = history[index++]!;
      if (!ambiguous.has(transition.created_at))
        fold.visibility(transition.visibility === "public", transition.created_at);
    }
    const calendar = fold.finish(owner.currentPublic, owner.agendaPath);
    if (!calendar) return;
    const slug = owner.currentPublic ? owner.slug : fold.publicSlug()!;
    if (Object.hasOwn(result, slug) || paths.has(calendar.agendaPath))
      throw new Error("PUBLIC_CALENDAR_ROUTE_CONFLICT");
    result[slug] = calendar;
    paths.add(calendar.agendaPath);
  };
  for (;;) {
    const page = await all<{
      event_id: string;
      slug: string;
      visibility: string;
      base_path: string | null;
      revision: number;
      snapshot_json: string;
      created_at: string;
    }>(
      db,
      `SELECT e.id AS event_id,e.slug,e.visibility,e.base_path,p.revision,p.snapshot_json,p.created_at
       FROM events e JOIN event_agenda_state s ON s.event_id=e.id
       JOIN event_agenda_publications p ON p.event_id=e.id AND p.revision<=s.published_revision
       WHERE (e.id>? OR (e.id=? AND p.revision>?)) ORDER BY e.id,p.revision LIMIT 100`,
      [afterEvent, afterEvent, afterRevision],
    );
    if (!page.length) break;
    count += page.length;
    if (count > APPROVAL_HISTORY_BUILD_LIMIT) throw new Error("PUBLIC_CALENDAR_HISTORY_BUDGET_EXCEEDED");
    for (const row of page) {
      if (owner?.eventId !== row.event_id) {
        finish();
        approvals = [];
        owner = {
          eventId: row.event_id,
          slug: row.slug,
          currentPublic: row.visibility === "public",
          agendaPath:
            (row.base_path?.startsWith("/") && !row.base_path.startsWith("//")
              ? row.base_path.replace(/\/$/u, "")
              : `/events/${encodeURIComponent(row.slug)}`) + "/agenda/",
        };
      }
      const snapshot = storedAgendaSnapshotSchema.parse(JSON.parse(row.snapshot_json));
      if (snapshot.revision !== row.revision || snapshot.publishedRevision !== row.revision)
        throw new Error("PUBLIC_CALENDAR_APPROVAL_BASIS_INVALID");
      const approvedAt = utcInstantSchema.parse(snapshot.approvedAt ?? row.created_at);
      if (approvals.length && approvedAt < approvals[approvals.length - 1]!.approvedAt!)
        throw new Error("PUBLIC_CALENDAR_HISTORY_ORDER_INVALID");
      approvals.push({ ...snapshot, approvedAt });
    }
    const last = page[page.length - 1]!;
    afterEvent = last.event_id;
    afterRevision = last.revision;
  }
  finish();
  return result;
}
