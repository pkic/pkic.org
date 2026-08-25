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
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { commitEventResourceManagementBatch } from "./management";
import { type EventGuestRow, toEventGuest } from "./record";
import { getManagedSeriesOccurrence } from "./occurrences";

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
  await getManagedSeriesOccurrence(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  const conditions = ["series_id = ?", "(occurrence_id IS NULL OR occurrence_id = ?)"];
  const bindings: unknown[] = [seriesId, occurrenceId];
  const search = query.q ? buildD1TextSearchFilter(query.q, ["name", "normalized_email", "affiliation"]) : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active !== undefined) {
    conditions.push(
      query.active
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
  const { context, series } = await getManagedSeriesOccurrence(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  if (series.guestPolicy === "none") {
    throw new AppError(409, "EVENT_GUESTS_DISABLED", "Guest invitations are disabled for this event");
  }
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
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
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
                  expires_at, revoked_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
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
              now,
              now,
            ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: context.groupId },
        "admin",
        actor.id,
        "event_guest_invited",
        "event_occurrence_guest",
        id,
        { seriesId, occurrenceId: scopedOccurrenceId, seriesWide: input.seriesWide ?? false },
      ),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_GUEST_CHANGED", "The guest invitation changed while it was being saved");
    }
    throw error;
  }
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
  const { context } = await getManagedSeriesOccurrence(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  const guest = await first<EventGuestRow>(
    db,
    `SELECT ${GUEST_COLUMNS} FROM event_occurrence_guests
      WHERE id = ? AND series_id = ? AND (occurrence_id IS NULL OR occurrence_id = ?)`,
    [guestId, seriesId, occurrenceId],
  );
  if (!guest) throw new AppError(404, "EVENT_GUEST_NOT_FOUND", "Guest invitation not found");
  const now = nowIso();
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      db
        .prepare(
          "UPDATE event_occurrence_guests SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL",
        )
        .bind(now, now, guestId),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: context.groupId },
        "admin",
        actor.id,
        "event_guest_revoked",
        "event_occurrence_guest",
        guestId,
        { seriesId, occurrenceId },
      ),
      db
        .prepare("UPDATE event_occurrence_access_tokens SET revoked_at = ? WHERE guest_id = ? AND revoked_at IS NULL")
        .bind(now, guestId),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_GUEST_CHANGED", "The guest invitation changed while it was being revoked");
    }
    throw error;
  }
}
