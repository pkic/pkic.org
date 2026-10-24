import { all } from "../../db/queries";
import { batchRows } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult } from "../../types";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { sessionHasPageContent } from "../../../../assets/shared/public-agenda-pages";
import {
  nextPublicPageSlug,
  publicPageSlugNameBase,
  publicPageSlugSchema,
  sessionPageSlugBase,
} from "../../../../assets/shared/schemas/public-page-slug";

const BATCH = 100;

export interface SessionPageSlugRow {
  slug: string;
  occurrenceId: string;
  retiredAt: string | null;
}
export interface ApprovedSessionTitle {
  occurrenceId: string;
  title: string;
}
export type SessionPageSlugChange =
  | { kind: "mint"; occurrenceId: string; slug: string }
  | { kind: "retire"; occurrenceId: string; slug: string }
  | { kind: "restore"; occurrenceId: string; slug: string };

/**
 * Plan address changes for one approval. A session keeps its address while its
 * approved title still yields it; a new title restores a former address of the
 * same session or issues a new one. `taken` holds every slug in the event.
 */
export function planSessionPageSlugs(
  sessions: readonly ApprovedSessionTitle[],
  rows: readonly SessionPageSlugRow[],
  taken: ReadonlySet<string>,
): SessionPageSlugChange[] {
  const reserved = new Set(taken);
  const changes: SessionPageSlugChange[] = [];
  for (const session of sessions) {
    const own = rows.filter((row) => row.occurrenceId === session.occurrenceId);
    const current = own.find((row) => row.retiredAt === null);
    const base = sessionPageSlugBase(session.title);
    if (current && publicPageSlugNameBase(current.slug) === base) continue;
    if (current) changes.push({ kind: "retire", occurrenceId: session.occurrenceId, slug: current.slug });
    const former = own.find((row) => row.retiredAt !== null && publicPageSlugNameBase(row.slug) === base);
    if (former) {
      changes.push({ kind: "restore", occurrenceId: session.occurrenceId, slug: former.slug });
      continue;
    }
    const slug = publicPageSlugSchema.parse(nextPublicPageSlug(base, reserved));
    reserved.add(slug);
    changes.push({ kind: "mint", occurrenceId: session.occurrenceId, slug });
  }
  return changes;
}

function prepareEventRows(db: DatabaseLike, eventId: string) {
  return db
    .prepare(
      `SELECT slug,occurrence_id AS occurrenceId,retired_at AS retiredAt FROM session_page_slugs
      WHERE event_id=? ORDER BY occurrence_id,created_at,slug`,
    )
    .bind(eventId);
}

/**
 * Statements that give every session with page content its readable address,
 * inside the approval's own atomic batch. Addresses are issued whatever the
 * event's visibility, so a later public event already has stable addresses.
 */
export function prepareSessionPageSlugsRead(db: DatabaseLike, eventId: string, approved: AgendaSnapshot, at: string) {
  const sessions = approved.occurrences
    .filter(sessionHasPageContent)
    .map((occurrence) => ({ occurrenceId: occurrence.id, title: occurrence.title }))
    .sort((a, b) => a.occurrenceId.localeCompare(b.occurrenceId));
  return {
    statements: sessions.length ? [prepareEventRows(db, eventId)] : [],
    decode(loaded: D1StatementResult[]) {
      if (!sessions.length) return [];
      const rows = batchRows<SessionPageSlugRow>(loaded[0]);
      const changes = planSessionPageSlugs(sessions, rows, new Set(rows.map((row) => row.slug)));
      return changes.map((change) =>
        change.kind === "retire"
          ? db
              .prepare(
                "UPDATE session_page_slugs SET retired_at=? WHERE event_id=? AND slug=? AND occurrence_id=? AND retired_at IS NULL",
              )
              .bind(at, eventId, change.slug, change.occurrenceId)
          : change.kind === "restore"
            ? db
                .prepare(
                  "UPDATE session_page_slugs SET retired_at=NULL WHERE event_id=? AND slug=? AND occurrence_id=?",
                )
                .bind(eventId, change.slug, change.occurrenceId)
            : db
                .prepare(
                  "INSERT INTO session_page_slugs(event_id,slug,occurrence_id,created_at,retired_at) VALUES(?,?,?,?,NULL)",
                )
                .bind(eventId, change.slug, change.occurrenceId, at),
      );
    },
  };
}

async function readOccurrenceRows(db: DatabaseLike, eventId: string, occurrenceIds: readonly string[]) {
  const rows: SessionPageSlugRow[] = [];
  for (let offset = 0; offset < occurrenceIds.length; offset += BATCH)
    rows.push(
      ...(await all<SessionPageSlugRow>(
        db,
        `SELECT slug,occurrence_id AS occurrenceId,retired_at AS retiredAt FROM session_page_slugs
          WHERE event_id=? AND occurrence_id IN (SELECT value FROM json_each(?)) ORDER BY occurrence_id,created_at,slug`,
        [eventId, JSON.stringify(occurrenceIds.slice(offset, offset + BATCH))],
      )),
    );
  return rows;
}

/** Attach the current address of every session with page content in this projection. */
export async function withSessionPageSlugs<T extends AgendaSnapshot>(
  db: DatabaseLike,
  eventId: string,
  snapshot: T,
): Promise<T> {
  const ids = snapshot.occurrences.filter(sessionHasPageContent).map((occurrence) => occurrence.id);
  const sessionSlugs: Record<string, string> = {};
  for (const row of await readOccurrenceRows(db, eventId, ids))
    if (row.retiredAt === null) sessionSlugs[row.occurrenceId] = row.slug;
  return { ...snapshot, sessionSlugs };
}

/** Every former address of the sessions this projection addresses. */
export async function readSessionPageRedirects(db: DatabaseLike, eventId: string, snapshot: AgendaSnapshot) {
  const current = snapshot.sessionSlugs ?? {};
  const rows = await readOccurrenceRows(db, eventId, Object.keys(current).sort());
  return rows
    .filter((row) => row.retiredAt !== null && current[row.occurrenceId] !== row.slug)
    .map((row) => ({ eventSlug: snapshot.eventSlug, occurrenceId: row.occurrenceId, fromSlug: row.slug }));
}
