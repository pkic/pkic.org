import type { z } from "zod";
import {
  eventOccurrenceGuestInviteSchema,
  eventOccurrenceGuestsListQuerySchema,
} from "../../../../assets/shared/schemas/event-series";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { normalizeEmail } from "../../validation";
import { prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { requireGroupManagement } from "../groups/governance";
import { type EventGuestRow, toEventGuest } from "./record";
import { getSeriesOccurrence } from "./occurrences";

type GuestInviteInput = z.infer<typeof eventOccurrenceGuestInviteSchema>;
type GuestListQuery = z.infer<typeof eventOccurrenceGuestsListQuerySchema>;

const GUEST_COLUMNS = `id, series_id, occurrence_id, user_id, normalized_email,
  name, affiliation, expires_at, revoked_at, created_at`;

export async function listOccurrenceGuests(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  query: GuestListQuery,
) {
  const { series } = await getSeriesOccurrence(db, groupIdOrSlug, seriesId, occurrenceId);
  await requireGroupManagement(db, actor, series.ownerGroupId);
  const conditions = ["series_id = ?", "(occurrence_id IS NULL OR occurrence_id = ?)"];
  const bindings: unknown[] = [seriesId, occurrenceId];
  const search = query.q ? buildD1TextSearchFilter(query.q, ["name", "normalized_email", "affiliation"]) : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active !== undefined) {
    conditions.push(
      query.active === "true"
        ? "revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')"
        : "(revoked_at IS NOT NULL OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const { rows, total } = await queryPage<EventGuestRow>(db, {
    source: {
      selectSql: `SELECT ${GUEST_COLUMNS}`,
      fromSql: `FROM event_occurrence_guests ${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name: "name COLLATE NOCASE", email: "normalized_email", created_at: "created_at" },
      "name COLLATE NOCASE ASC",
      "id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return {
    guests: rows.map((row) => toEventGuest({ ...row, response_occurrence_id: occurrenceId })),
    total,
  };
}

export async function inviteOccurrenceGuest(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  input: GuestInviteInput,
) {
  const { series } = await getSeriesOccurrence(db, groupIdOrSlug, seriesId, occurrenceId);
  await requireGroupManagement(db, actor, series.ownerGroupId);
  if (input.expiresAt <= nowIso()) {
    throw new AppError(422, "EVENT_GUEST_EXPIRY_INVALID", "Guest access must expire in the future");
  }
  const email = normalizeEmail(input.email);
  const scopedOccurrenceId = input.seriesWide ? null : occurrenceId;
  const existing = await first<EventGuestRow>(
    db,
    `SELECT ${GUEST_COLUMNS} FROM event_occurrence_guests
      WHERE series_id = ? AND normalized_email = ?
        AND ((? IS NULL AND occurrence_id IS NULL) OR occurrence_id = ?)`,
    [seriesId, email, scopedOccurrenceId, scopedOccurrenceId],
  );
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ? AND active = 1", [
    email,
  ]);
  const id = existing?.id ?? uuid();
  const now = nowIso();
  await db.batch([
    existing
      ? db
          .prepare(
            `UPDATE event_occurrence_guests SET user_id = ?, name = ?, affiliation = ?,
               expires_at = ?, revoked_at = NULL, updated_at = ? WHERE id = ?`,
          )
          .bind(user?.id ?? null, input.name, input.affiliation ?? null, input.expiresAt, now, id)
      : db
          .prepare(
            `INSERT INTO event_occurrence_guests
               (id, series_id, occurrence_id, user_id, normalized_email, name, affiliation,
                expires_at, invited_by_user_id, revoked_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .bind(
            id,
            seriesId,
            scopedOccurrenceId,
            user?.id ?? null,
            email,
            input.name,
            input.affiliation ?? null,
            input.expiresAt,
            actor.id,
            now,
            now,
          ),
    prepareAuditLog(db, "admin", actor.id, "event_guest_invited", "event_occurrence_guest", id, {
      seriesId,
      occurrenceId: scopedOccurrenceId,
      seriesWide: input.seriesWide ?? false,
    }),
  ]);
  const row = await first<EventGuestRow>(db, `SELECT ${GUEST_COLUMNS} FROM event_occurrence_guests WHERE id = ?`, [id]);
  if (!row) throw new AppError(500, "EVENT_GUEST_READ_FAILED", "Failed to read guest invitation");
  return toEventGuest({ ...row, response_occurrence_id: occurrenceId });
}

export async function revokeOccurrenceGuest(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  guestId: string,
): Promise<void> {
  const { series } = await getSeriesOccurrence(db, groupIdOrSlug, seriesId, occurrenceId);
  await requireGroupManagement(db, actor, series.ownerGroupId);
  const guest = await first<EventGuestRow>(
    db,
    `SELECT ${GUEST_COLUMNS} FROM event_occurrence_guests
      WHERE id = ? AND series_id = ? AND (occurrence_id IS NULL OR occurrence_id = ?)`,
    [guestId, seriesId, occurrenceId],
  );
  if (!guest) throw new AppError(404, "EVENT_GUEST_NOT_FOUND", "Guest invitation not found");
  const now = nowIso();
  await db.batch([
    db
      .prepare("UPDATE event_occurrence_guests SET revoked_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, guestId),
    db
      .prepare("UPDATE event_occurrence_access_tokens SET revoked_at = ? WHERE guest_id = ? AND revoked_at IS NULL")
      .bind(now, guestId),
    prepareAuditLogAfterOneChange(db, "admin", actor.id, "event_guest_revoked", "event_occurrence_guest", guestId, {
      seriesId,
      occurrenceId,
    }),
  ]);
}
