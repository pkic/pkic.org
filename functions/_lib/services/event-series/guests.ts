import type { z } from "zod";
import {
  eventOccurrenceGuestInviteSchema,
  eventOccurrenceGuestsListQuerySchema,
} from "../../../../assets/shared/schemas/event-series";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { newCapabilityLinkSecret } from "../../auth/capability-links";
import {
  effectiveMeetingGuestInviteExpirySql,
  eventInviteWindowEvidence,
  eventOccurrenceInviteWindowEvidence,
  resolveEventInviteExpiry,
  type InviteEventWindow,
} from "../../invite-validity";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { normalizeEmail } from "../../validation";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { commitEventResourceManagementBatch, queryEventResourceManagementPage } from "./management";
import { prepareMeetingGuestInvitationDelivery } from "./guest-delivery";
import { type EventGuestRow, toEventGuest } from "./record";
import { getManagedSeriesOccurrence } from "./occurrences";

type GuestInviteInput = z.infer<typeof eventOccurrenceGuestInviteSchema>;
type GuestListQuery = z.infer<typeof eventOccurrenceGuestsListQuerySchema>;

const RAW_GUEST_COLUMNS = `id, series_id, occurrence_id, user_id, normalized_email,
  name, affiliation, invitation_secret, invitation_version,
  expires_at, 0 AS active, revoked_at, created_at, updated_at`;
const EFFECTIVE_GUEST_EXPIRY = effectiveMeetingGuestInviteExpirySql();
const EFFECTIVE_GUEST_COLUMNS = `guest.id, guest.series_id, guest.occurrence_id, guest.user_id,
  guest.normalized_email, guest.name, guest.affiliation, guest.invitation_secret, guest.invitation_version,
  COALESCE(${EFFECTIVE_GUEST_EXPIRY}, guest.expires_at) AS expires_at,
  CASE WHEN guest.revoked_at IS NULL
         AND ${EFFECTIVE_GUEST_EXPIRY} IS NOT NULL
         AND unixepoch(${EFFECTIVE_GUEST_EXPIRY}) > unixepoch()
       THEN 1 ELSE 0 END AS active,
  guest.revoked_at, guest.created_at, guest.updated_at`;
const EFFECTIVE_GUEST_FROM = `FROM event_occurrence_guests guest
  JOIN event_series series ON series.id = guest.series_id
  JOIN events event ON event.id = series.event_id
  LEFT JOIN event_occurrences guest_occurrence
    ON guest_occurrence.id = guest.occurrence_id AND guest_occurrence.series_id = guest.series_id`;

export async function listOccurrenceGuests(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  query: GuestListQuery,
) {
  const { context } = await getManagedSeriesOccurrence(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  const { rows, total } = await queryEventResourceManagementPage<EventGuestRow>(
    db,
    actor,
    context,
    "manage",
    buildOccurrenceGuestsPageQuery(seriesId, occurrenceId, query),
  );
  return {
    guests: rows.map((row) => toEventGuest({ ...row, response_occurrence_id: occurrenceId })),
    total,
  };
}

/** Canonical page/count query for occurrence guests, also used by D1 EXPLAIN tests. */
export function buildOccurrenceGuestsPageQuery(seriesId: string, occurrenceId: string, query: GuestListQuery) {
  const conditions = ["guest.series_id = ?", "(guest.occurrence_id IS NULL OR guest.occurrence_id = ?)"];
  const bindings: unknown[] = [seriesId, occurrenceId];
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["guest.name", "guest.normalized_email", "guest.affiliation"])
    : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active !== undefined) {
    conditions.push(
      query.active
        ? `guest.revoked_at IS NULL
           AND ${EFFECTIVE_GUEST_EXPIRY} > strftime('%Y-%m-%dT%H:%M:%fZ','now')`
        : `(guest.revoked_at IS NOT NULL
            OR ${EFFECTIVE_GUEST_EXPIRY} IS NULL
            OR ${EFFECTIVE_GUEST_EXPIRY} <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  return {
    source: {
      selectSql: `SELECT ${EFFECTIVE_GUEST_COLUMNS}`,
      fromSql: `${EFFECTIVE_GUEST_FROM} ${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name: "guest.name COLLATE NOCASE", email: "guest.normalized_email", created_at: "guest.created_at" },
      "guest.name COLLATE NOCASE ASC",
      "guest.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function inviteOccurrenceGuest(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  input: GuestInviteInput,
  appBaseUrl: string,
) {
  const { context, series, occurrence } = await getManagedSeriesOccurrence(
    db,
    actor,
    groupIdOrSlug,
    seriesId,
    occurrenceId,
  );
  if (series.guestPolicy === "none") {
    throw new AppError(409, "EVENT_GUESTS_DISABLED", "Guest invitations are disabled for this event");
  }
  const now = nowIso();
  const inviteWindow: InviteEventWindow = input.seriesWide
    ? { starts_at: series.inviteWindow.startsAt, ends_at: series.inviteWindow.endsAt }
    : { starts_at: occurrence.startsAt, ends_at: occurrence.endsAt };
  const expiresAt = resolveEventInviteExpiry(inviteWindow, input.expiresAt, now);
  const email = normalizeEmail(input.email);
  const scopedOccurrenceId = input.seriesWide ? null : occurrenceId;
  const existing = await first<EventGuestRow>(
    db,
    `SELECT ${RAW_GUEST_COLUMNS} FROM event_occurrence_guests
      WHERE series_id = ? AND normalized_email = ?
        AND ((? IS NULL AND occurrence_id IS NULL) OR occurrence_id = ?)`,
    [seriesId, email, scopedOccurrenceId, scopedOccurrenceId],
  );
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ? AND active = 1", [
    email,
  ]);
  const id = existing?.id ?? uuid();
  const invitationSecret = newCapabilityLinkSecret();
  const invitationVersion = (existing?.invitation_version ?? 0) + 1;
  const delivery = await prepareMeetingGuestInvitationDelivery(db, {
    guestId: id,
    invitationSecret,
    invitationVersion,
    expiresAt,
    recipientEmail: email,
    guestName: input.name,
    eventName: series.eventName,
    startsAt: occurrence.startsAt,
    occurrenceId,
    appBaseUrl,
  });
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      prepareAuthorizationGuard(
        db,
        input.seriesWide
          ? eventInviteWindowEvidence(series.eventId, inviteWindow, expiresAt, now)
          : eventOccurrenceInviteWindowEvidence(seriesId, occurrenceId, inviteWindow, expiresAt, now),
      ),
      existing
        ? db
            .prepare(
              `UPDATE event_occurrence_guests SET user_id = ?, name = ?, affiliation = ?,
                 invitation_secret = ?, invitation_version = ?, expires_at = ?,
                 revoked_at = NULL, updated_at = ?
               WHERE id = ? AND updated_at = ?`,
            )
            .bind(
              user?.id ?? null,
              input.name,
              input.affiliation ?? null,
              invitationSecret,
              invitationVersion,
              expiresAt,
              now,
              id,
              existing.updated_at,
            )
        : db
            .prepare(
              `INSERT INTO event_occurrence_guests
                 (id, series_id, occurrence_id, user_id, normalized_email, name, affiliation,
                  invitation_secret, invitation_version, expires_at, revoked_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
            )
            .bind(
              id,
              seriesId,
              scopedOccurrenceId,
              user?.id ?? null,
              email,
              input.name,
              input.affiliation ?? null,
              invitationSecret,
              invitationVersion,
              expiresAt,
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
        { seriesId, occurrenceId: scopedOccurrenceId, seriesWide: input.seriesWide ?? false, expiresAt },
      ),
      ...(existing
        ? [
            db
              .prepare("UPDATE meeting_guest_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE guest_id = ?")
              .bind(now, id),
            db
              .prepare(
                `UPDATE meeting_guest_browser_challenges SET used_at = COALESCE(used_at, ?)
                  WHERE guest_id = ? AND used_at IS NULL`,
              )
              .bind(now, id),
          ]
        : []),
      delivery.statement,
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "EVENT_GUEST_WINDOW_CHANGED", "The guest invitation window changed while saving");
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_GUEST_CHANGED", "The guest invitation changed while it was being saved");
    }
    throw error;
  }
  const row = await first<EventGuestRow>(
    db,
    `SELECT ${EFFECTIVE_GUEST_COLUMNS} ${EFFECTIVE_GUEST_FROM} WHERE guest.id = ?`,
    [id],
  );
  if (!row) throw new AppError(500, "EVENT_GUEST_READ_FAILED", "Failed to read guest invitation");
  return { guest: toEventGuest({ ...row, response_occurrence_id: occurrenceId }), outboxId: delivery.id };
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
    `SELECT ${RAW_GUEST_COLUMNS} FROM event_occurrence_guests
      WHERE id = ? AND series_id = ? AND (occurrence_id IS NULL OR occurrence_id = ?)`,
    [guestId, seriesId, occurrenceId],
  );
  if (!guest) throw new AppError(404, "EVENT_GUEST_NOT_FOUND", "Guest invitation not found");
  const now = nowIso();
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      db
        .prepare(
          `UPDATE event_occurrence_guests SET invitation_secret = ?,
             invitation_version = invitation_version + 1, revoked_at = ?, updated_at = ?
           WHERE id = ? AND revoked_at IS NULL AND updated_at = ?`,
        )
        .bind(newCapabilityLinkSecret(), now, now, guestId, guest.updated_at),
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
        .prepare("UPDATE meeting_guest_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE guest_id = ?")
        .bind(now, guestId),
      db
        .prepare(
          "UPDATE meeting_guest_browser_challenges SET used_at = COALESCE(used_at, ?) WHERE guest_id = ? AND used_at IS NULL",
        )
        .bind(now, guestId),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_GUEST_CHANGED", "The guest invitation changed while it was being revoked");
    }
    throw error;
  }
}
