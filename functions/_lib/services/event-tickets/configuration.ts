/**
 * An event's ticket configuration as organizers read and change it. Every
 * change is one guarded batch: the organizer's permission, the revision the
 * organizer saw, the change itself, and its audit entry.
 */
import { readSponsorPassTiers } from "./sponsor-pass-tiers";
import {
  DEFAULT_PAYMENT_REMINDER_INTERVAL_DAYS,
  DEFAULT_PAYMENT_REMINDER_PERIOD_DAYS,
  DEFAULT_PAYMENT_RETRY_DAYS,
} from "../../../../assets/shared/event-tickets";
import type {
  EventTicketPricesReplaceInput,
  EventTicketGuidanceUpdate,
  EventTicketSettingsUpdate,
  EventTicketTypeInput,
  EventTicketsConfiguration,
} from "../../../../assets/shared/schemas/event-tickets";
import type { EventTicketCode, EventTicketCodeCreate } from "../../../../assets/shared/schemas/event-ticket-codes";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { batchFirst, batchRows } from "../../db/pagination";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { prepareEventDays, type EventDayRecord } from "../event-days";
import { prepareDecidedOrganizationCounts } from "./classifier";
import { normalizeTicketCode } from "./assignment";
import { eventSponsorsCte } from "./event-sponsors";
import {
  decodeEventTicketSnapshot,
  EVENT_TICKET_SNAPSHOT_STATEMENTS,
  prepareEventTicketSnapshot,
  readEventTicketSnapshot,
  eventAttendanceOptions,
} from "./snapshot";

interface EventRef {
  id: string;
  timezone: string;
}

interface TypeCountRow {
  ticket_type_id: string;
  registered: number;
  paid: number;
  under_review: number;
  awaiting: number;
  paid_amount: number;
  under_review_amount: number;
  awaiting_amount: number;
  free: number;
}

export interface CodeRow {
  id: string;
  ticket_type_id: string;
  label: string;
  code: string;
  amount: number | null;
  percent_off: number | null;
  max_uses: number;
  used_count: number;
  revoked_at: string | null;
  sponsor_id: string | null;
  sponsor_name: string | null;
  registrations: number;
  revenue: number;
}

/** A code's own columns, its sponsor, and the tickets issued with it; selected from `event_ticket_codes` unaliased. */
export const CODE_COLUMNS = `id, ticket_type_id, label, code, amount, percent_off, max_uses, used_count, revoked_at,
  COALESCE(organization_id, sponsorship_id) AS sponsor_id,
  COALESCE((SELECT name FROM organizations WHERE id = event_ticket_codes.organization_id),
    (SELECT COALESCE(owner.name, sponsor.non_member_name, 'Sponsor') FROM sponsorships sponsor
       LEFT JOIN organizations owner ON owner.id = sponsor.organization_id
     WHERE sponsor.id = event_ticket_codes.sponsorship_id)) AS sponsor_name,
  (SELECT COUNT(*) FROM registration_tickets issued WHERE issued.code_id = event_ticket_codes.id) AS registrations,
  (SELECT COALESCE(SUM(issued.paid_amount - issued.refunded_amount), 0) FROM registration_tickets issued
   WHERE issued.code_id = event_ticket_codes.id AND issued.status IN ('paid', 'refunded')) AS revenue`;

export function decodeCode(row: CodeRow): EventTicketCode {
  return {
    id: row.id,
    ticketTypeId: row.ticket_type_id,
    label: row.label,
    code: row.code,
    amount: row.amount,
    percentOff: row.percent_off,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    revokedAt: row.revoked_at,
    sponsor: row.sponsor_id ? { id: row.sponsor_id, name: row.sponsor_name ?? "Sponsor" } : null,
    registrations: row.registrations,
    revenue: row.revenue,
  };
}

export async function readEventTicketsConfiguration(
  db: DatabaseLike,
  event: EventRef,
): Promise<EventTicketsConfiguration> {
  const results = await db.batch([
    ...prepareEventTicketSnapshot(db, event.id),
    db
      .prepare(
        `SELECT ticket.ticket_type_id,
                COUNT(*) AS registered,
                SUM(ticket.status = 'paid') AS paid,
                SUM(ticket.status = 'payment_under_review') AS under_review,
                SUM(ticket.status = 'pending_payment') AS awaiting,
                SUM(CASE WHEN ticket.status = 'paid' THEN ticket.paid_amount - ticket.refunded_amount ELSE 0 END) AS paid_amount,
                SUM(CASE WHEN ticket.status = 'payment_under_review' THEN ticket.paid_amount - ticket.refunded_amount ELSE 0 END) AS under_review_amount,
                SUM(CASE WHEN ticket.status = 'pending_payment' THEN ticket.amount ELSE 0 END) AS awaiting_amount,
                SUM(ticket.status = 'free') AS free
         FROM registration_tickets ticket JOIN registrations registration ON registration.id = ticket.registration_id
         WHERE ticket.event_id = ? AND registration.status <> 'cancelled'
           AND ticket.status IN ('free', 'pending_payment', 'paid', 'payment_under_review')
         GROUP BY ticket.ticket_type_id`,
      )
      .bind(event.id),
    prepareEventDays(db, event.id),
  ]);
  const snapshot = decodeEventTicketSnapshot(results.slice(0, EVENT_TICKET_SNAPSHOT_STATEMENTS), event.timezone);
  const [countsResult, daysResult] = results.slice(EVENT_TICKET_SNAPSHOT_STATEMENTS);
  const counts = new Map(batchRows<TypeCountRow>(countsResult).map((row) => [row.ticket_type_id, row]));
  const days = batchRows<EventDayRecord>(daysResult);
  const presets = await db.batch([prepareDecidedOrganizationCounts(db, snapshot.types)]);
  const presetCounts = new Map(
    batchRows<{ ticket_key: string; total: number }>(presets[0]).map((row) => [row.ticket_key, row.total]),
  );
  const sponsorSettings = await first<{ staff: string | null; customers: string | null }>(
    db,
    `SELECT sponsor_staff_ticket_type_id AS staff, sponsor_customer_ticket_type_id AS customers
     FROM event_ticket_settings WHERE event_id = ?`,
    [event.id],
  );
  const sum = (pick: (row: TypeCountRow) => number) =>
    [...counts.values()].reduce((total, row) => total + pick(row), 0);
  return {
    revision: snapshot.settings?.revision ?? 0,
    timeZone: event.timezone,
    settings: {
      currency: snapshot.settings?.currency ?? "usd",
      reminderIntervalDays: snapshot.settings?.reminder_interval_days ?? DEFAULT_PAYMENT_REMINDER_INTERVAL_DAYS,
      reminderPeriodDays: snapshot.settings?.reminder_period_days ?? DEFAULT_PAYMENT_REMINDER_PERIOD_DAYS,
      unpaidHoldDays: snapshot.settings?.unpaid_hold_days ?? null,
      paymentRetryDays: snapshot.settings?.payment_retry_days ?? DEFAULT_PAYMENT_RETRY_DAYS,
      transferable: (snapshot.settings?.tickets_transferable ?? 0) === 1,
      sendInvoice: (snapshot.settings?.send_invoice ?? 1) === 1,
      refundDaysBeforeEvent: snapshot.settings?.refund_days_before_event ?? null,
      refundFee: snapshot.settings?.refund_fee ?? 0,
      ticketIntro: snapshot.settings?.ticket_intro ?? "",
      attendanceIntro: snapshot.settings?.attendance_intro ?? "",
    },
    currentPeriodId: snapshot.current?.id ?? null,
    types: snapshot.types.map((type) => ({
      id: type.id,
      key: type.ticket_key,
      name: type.name,
      descriptionMarkdown: type.description_markdown,
      classifierDescription: type.classifier_description ?? "",
      classifierThresholdPercent: Math.round(type.classifier_threshold * 100),
      isDefault: type.is_default === 1,
      freeRequiresWorkEmail: type.free_requires_work_email === 1,
      active: type.active === 1,
      sortOrder: type.sort_order,
      registered: counts.get(type.id)?.registered ?? 0,
      paid: counts.get(type.id)?.paid ?? 0,
      underReview: counts.get(type.id)?.under_review ?? 0,
      awaitingPayment: counts.get(type.id)?.awaiting ?? 0,
      presetOrganizations: presetCounts.get(type.ticket_key) ?? 0,
    })),
    periods: snapshot.periods,
    prices: snapshot.prices,
    sponsorPasses: {
      staffTicketTypeId: sponsorSettings?.staff ?? null,
      customerTicketTypeId: sponsorSettings?.customers ?? null,
      tiers: await readSponsorPassTiers(db, event.id),
    },
    attendanceOptions: eventAttendanceOptions(days),
    days: days.map((day) => ({ dayDate: day.day_date, label: day.label })),
    totals: {
      collected: sum((row) => row.paid_amount),
      paidCount: sum((row) => row.paid),
      underReviewCount: sum((row) => row.under_review),
      underReviewAmount: sum((row) => row.under_review_amount),
      awaitingAmount: sum((row) => row.awaiting_amount),
      awaitingCount: sum((row) => row.awaiting),
      freeCount: sum((row) => row.free),
    },
  };
}

/** The guards and the revision step every configuration change shares. */
export function prepareConfigurationChange(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  expectedRevision: number,
  now: string,
): StatementLike[] {
  return [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: eventId } },
    ]),
    prepareStateGuard(db, {
      sql: "SELECT 1 WHERE COALESCE((SELECT revision FROM event_ticket_settings WHERE event_id = ?), 0) = ?",
      bindings: [eventId, expectedRevision],
    }),
    db
      .prepare(
        `INSERT INTO event_ticket_settings (event_id, currency, reminder_interval_days, reminder_period_days, revision, updated_at)
         VALUES (?, 'usd', ?, ?, 1, ?)
         ON CONFLICT(event_id) DO UPDATE SET revision = event_ticket_settings.revision + 1, updated_at = excluded.updated_at`,
      )
      .bind(eventId, DEFAULT_PAYMENT_REMINDER_INTERVAL_DAYS, DEFAULT_PAYMENT_REMINDER_PERIOD_DAYS, now),
  ];
}

export async function commitConfigurationChange(db: DatabaseLike, statements: StatementLike[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isStateGuardFailure(error))
      throw new AppError(
        409,
        "EVENT_TICKETS_CHANGED",
        "The tickets changed while you were editing. Reload and try again.",
      );
    if (error instanceof Error && /UNIQUE constraint failed: event_ticket_types/.test(error.message))
      throw new AppError(409, "TICKET_KEY_TAKEN", "Another ticket of this event already uses this key.");
    throw error;
  }
}

export async function saveEventTicketType(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: EventRef,
  ticketTypeId: string | null,
  input: EventTicketTypeInput,
): Promise<{ revision: number }> {
  const now = nowIso();
  const id = ticketTypeId ?? uuid();
  if (ticketTypeId) {
    const existing = await first<{ id: string }>(
      db,
      "SELECT id FROM event_ticket_types WHERE id = ? AND event_id = ?",
      [ticketTypeId, event.id],
    );
    if (!existing) throw new AppError(404, "TICKET_NOT_FOUND", "This ticket no longer exists.");
  }
  const values = [
    input.key,
    input.name,
    input.descriptionMarkdown,
    input.classifierDescription.trim() || null,
    input.classifierThresholdPercent / 100,
    input.isDefault ? 1 : 0,
    input.freeRequiresWorkEmail ? 1 : 0,
    input.active ? 1 : 0,
    now,
  ];
  await commitConfigurationChange(db, [
    ...prepareConfigurationChange(db, actor, event.id, input.expectedRevision, now),
    // One default per event: the new default takes the place of the old one.
    ...(input.isDefault
      ? [db.prepare("UPDATE event_ticket_types SET is_default = 0 WHERE event_id = ? AND id <> ?").bind(event.id, id)]
      : []),
    ticketTypeId
      ? db
          .prepare(
            `UPDATE event_ticket_types SET ticket_key = ?, name = ?, description_markdown = ?, classifier_description = ?,
               classifier_threshold = ?, is_default = ?, free_requires_work_email = ?, active = ?, updated_at = ?
             WHERE id = ? AND event_id = ?`,
          )
          .bind(...values, id, event.id)
      : db
          .prepare(
            `INSERT INTO event_ticket_types
               (ticket_key, name, description_markdown, classifier_description, classifier_threshold, is_default,
                free_requires_work_email, active, updated_at, id, event_id, sort_order, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(sort_order), -10) + 10, ?
             FROM event_ticket_types WHERE event_id = ?`,
          )
          .bind(...values, id, event.id, now, event.id),
    prepareAuditLog(
      db,
      "user",
      actor.id,
      ticketTypeId ? "event_ticket_changed" : "event_ticket_added",
      "event",
      event.id,
      {
        ticketKey: input.key,
      },
    ),
  ]);
  return { revision: input.expectedRevision + 1 };
}

export async function replaceEventTicketPrices(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: EventRef,
  input: EventTicketPricesReplaceInput,
): Promise<{ revision: number }> {
  const snapshot = await readEventTicketSnapshot(db, event);
  const typeIds = new Set(snapshot.types.map((type) => type.id));
  if (input.prices.some((price) => !typeIds.has(price.ticketTypeId)))
    throw new AppError(
      409,
      "EVENT_TICKETS_CHANGED",
      "The tickets changed while you were editing. Reload and try again.",
    );
  const now = nowIso();
  // Periods keep their id when their date is unchanged, so "current period" stays stable across saves.
  const existingByDate = new Map(snapshot.periods.map((period) => [period.startsOn ?? "", period.id]));
  const periodIds = new Map(
    input.periods.map((period) => [period.id, existingByDate.get(period.startsOn ?? "") ?? uuid()]),
  );
  const kept = new Set(periodIds.values());
  const statements: StatementLike[] = [...prepareConfigurationChange(db, actor, event.id, input.expectedRevision, now)];
  statements.push(
    db
      .prepare(
        `DELETE FROM event_ticket_prices WHERE ticket_type_id IN (SELECT id FROM event_ticket_types WHERE event_id = ?)`,
      )
      .bind(event.id),
  );
  for (const period of snapshot.periods)
    if (!kept.has(period.id))
      statements.push(db.prepare("DELETE FROM event_ticket_price_periods WHERE id = ?").bind(period.id));
  for (const period of input.periods) {
    const id = periodIds.get(period.id)!;
    if (!snapshot.periods.some((existing) => existing.id === id))
      statements.push(
        db
          .prepare("INSERT INTO event_ticket_price_periods (id, event_id, starts_on) VALUES (?, ?, ?)")
          .bind(id, event.id, period.startsOn),
      );
  }
  for (const price of input.prices) {
    const id = uuid();
    statements.push(
      db
        .prepare(
          "INSERT INTO event_ticket_prices (id, ticket_type_id, attendance_value, day_date, charged) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id, price.ticketTypeId, price.attendanceValue, price.dayDate, price.charged),
    );
    for (const [reference, amount] of Object.entries(price.amounts)) {
      const periodId = periodIds.get(reference);
      if (!periodId || amount === 0) continue;
      statements.push(
        db
          .prepare("INSERT INTO event_ticket_price_amounts (price_id, period_id, amount) VALUES (?, ?, ?)")
          .bind(id, periodId, amount),
      );
    }
  }
  statements.push(
    prepareAuditLog(db, "user", actor.id, "event_ticket_prices_replaced", "event", event.id, {
      periods: input.periods.length,
      prices: input.prices.length,
    }),
  );
  await commitConfigurationChange(db, statements);
  return { revision: input.expectedRevision + 1 };
}

export async function updateEventTicketSettings(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: EventRef,
  input: EventTicketSettingsUpdate,
): Promise<{ revision: number }> {
  const now = nowIso();
  const fixed = await first<{ currency: string }>(
    db,
    `SELECT settings.currency FROM event_ticket_settings settings WHERE settings.event_id = ?1
       AND EXISTS (SELECT 1 FROM registration_tickets ticket
                   WHERE ticket.event_id = ?1 AND ticket.status IN ('pending_payment', 'paid', 'payment_under_review', 'refunded'))`,
    [event.id],
  );
  if (fixed && fixed.currency !== input.currency) {
    const message = `People already hold tickets priced in ${fixed.currency.toUpperCase()}. The currency can no longer change.`;
    throw new AppError(422, "TICKET_CURRENCY_FIXED", message, { fieldErrors: { currency: [message] } });
  }
  await commitConfigurationChange(db, [
    ...prepareConfigurationChange(db, actor, event.id, input.expectedRevision, now),
    // Tickets keep the currency they were issued in, so the event's currency is fixed once one costs something.
    prepareStateGuard(db, {
      sql: `SELECT 1 FROM event_ticket_settings settings WHERE settings.event_id = ?
              AND (settings.currency = ? OR NOT EXISTS (
                SELECT 1 FROM registration_tickets ticket
                WHERE ticket.event_id = settings.event_id
                  AND ticket.status IN ('pending_payment', 'paid', 'payment_under_review', 'refunded')))`,
      bindings: [event.id, input.currency],
    }),
    db
      .prepare(
        `UPDATE event_ticket_settings SET currency = ?, reminder_interval_days = ?, reminder_period_days = ?, unpaid_hold_days = ?, payment_retry_days = ?, tickets_transferable = ?, send_invoice = ?,
           refund_days_before_event = ?, refund_fee = ?
         WHERE event_id = ?`,
      )
      .bind(
        input.currency,
        input.reminderIntervalDays,
        input.reminderPeriodDays,
        input.unpaidHoldDays,
        input.paymentRetryDays,
        input.transferable ? 1 : 0,
        input.sendInvoice ? 1 : 0,
        input.refundDaysBeforeEvent,
        input.refundFee,
        event.id,
      ),
    prepareAuditLog(db, "user", actor.id, "event_ticket_settings_changed", "event", event.id, {
      currency: input.currency,
      reminderIntervalDays: input.reminderIntervalDays,
      reminderPeriodDays: input.reminderPeriodDays,
      unpaidHoldDays: input.unpaidHoldDays,
      paymentRetryDays: input.paymentRetryDays,
      transferable: input.transferable,
      refundDaysBeforeEvent: input.refundDaysBeforeEvent,
      refundFee: input.refundFee,
    }),
  ]);
  return { revision: input.expectedRevision + 1 };
}

/** What registrants read above the tickets and above the days; empty shows nothing. */
export async function updateEventTicketGuidance(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: EventRef,
  input: EventTicketGuidanceUpdate,
): Promise<{ revision: number }> {
  const now = nowIso();
  await commitConfigurationChange(db, [
    ...prepareConfigurationChange(db, actor, event.id, input.expectedRevision, now),
    db
      .prepare("UPDATE event_ticket_settings SET ticket_intro = ?, attendance_intro = ? WHERE event_id = ?")
      .bind(input.ticketIntro, input.attendanceIntro, event.id),
    prepareAuditLog(db, "user", actor.id, "event_ticket_guidance_changed", "event", event.id, {}),
  ]);
  return { revision: input.expectedRevision + 1 };
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A code people can read aloud and type: twelve characters without look-alikes. */
export function generateTicketCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export async function createEventTicketCode(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: EventRef,
  input: EventTicketCodeCreate,
): Promise<EventTicketCode> {
  const now = nowIso();
  const id = uuid();
  const code = normalizeTicketCode(generateTicketCode());
  const amount = input.discount === "amount" ? (input.amount ?? 0) : null;
  const percentOff = input.discount === "percent" ? (input.percentOff ?? null) : null;
  const sponsorId = input.sponsorId ?? null;
  const unavailable = () =>
    new AppError(
      409,
      "EVENT_TICKETS_CHANGED",
      sponsorId
        ? "This ticket or sponsor is no longer available. Reload and try again."
        : "This ticket is no longer available. Reload and try again.",
    );
  const results = await db
    .batch([
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "events:write", context: { type: "event", id: event.id } },
      ]),
      // A code for a sponsor is only made when that sponsor still sponsors the event.
      db
        .prepare(
          `WITH ${eventSponsorsCte("?11")}
         INSERT INTO event_ticket_codes
           (id, event_id, ticket_type_id, label, code, amount, percent_off, max_uses, organization_id, sponsorship_id,
            created_by_user_id, created_at, updated_at)
         SELECT ?1, ?11, type.id, ?2, ?3, ?4, ?5, ?6, sponsor.organization_id,
                CASE WHEN sponsor.organization_id IS NULL THEN sponsor.sponsorship_id END, ?7, ?8, ?8
         FROM event_ticket_types type LEFT JOIN event_sponsors sponsor ON sponsor.sponsor_id = ?9
         WHERE type.id = ?10 AND type.event_id = ?11 AND type.active = 1
           AND (?9 IS NULL OR sponsor.sponsor_id IS NOT NULL)
         LIMIT 1`,
        )
        .bind(
          id,
          input.label,
          code,
          amount,
          percentOff,
          input.maxUses,
          actor.id,
          now,
          sponsorId,
          input.ticketTypeId,
          event.id,
        ),
      // The audit entry is written only with the code: the ticket or sponsor may have gone since the form was read.
      prepareStateGuard(db, { sql: "SELECT 1 FROM event_ticket_codes WHERE id = ?", bindings: [id] }),
      prepareAuditLog(db, "user", actor.id, "event_ticket_code_created", "event", event.id, {
        codeId: id,
        maxUses: input.maxUses,
        sponsorId,
      }),
      db.prepare(`SELECT ${CODE_COLUMNS} FROM event_ticket_codes WHERE id = ?`).bind(id),
    ])
    .catch((cause: unknown) => {
      throw isStateGuardFailure(cause) ? unavailable() : cause;
    });
  const row = batchFirst<CodeRow>(results[4]);
  if (!row) throw unavailable();
  return decodeCode(row);
}

export async function updateEventTicketCode(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: EventRef,
  codeId: string,
  input: { maxUses?: number; addUses?: number; revoked?: boolean },
): Promise<void> {
  const existing = await first<{ used_count: number }>(
    db,
    "SELECT used_count FROM event_ticket_codes WHERE id = ? AND event_id = ?",
    [codeId, event.id],
  );
  if (!existing) throw new AppError(404, "TICKET_CODE_NOT_FOUND", "This code no longer exists.");
  if (input.maxUses !== undefined && input.maxUses < existing.used_count)
    throw new AppError(
      422,
      "TICKET_CODE_LIMIT_TOO_LOW",
      `This code is already used ${existing.used_count} times. Enter that or more.`,
      {
        fieldErrors: { maxUses: [`This code is already used ${existing.used_count} times. Enter that or more.`] },
      },
    );
  const now = nowIso();
  await db
    .batch([
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "events:write", context: { type: "event", id: event.id } },
      ]),
      // A registration that used the code meanwhile can put the new limit below its uses; then nothing is written.
      prepareStateGuard(db, {
        sql: "SELECT 1 FROM event_ticket_codes WHERE id = ? AND event_id = ? AND used_count <= COALESCE(?, max_uses)",
        bindings: [codeId, event.id, input.maxUses ?? null],
      }),
      db
        .prepare(
          `UPDATE event_ticket_codes SET
           max_uses = MIN(COALESCE(?, max_uses) + ?, 10000),
           revoked_at = CASE WHEN ? IS NULL THEN revoked_at WHEN ? = 1 THEN COALESCE(revoked_at, ?) ELSE NULL END,
           updated_at = ?
         WHERE id = ? AND event_id = ? AND used_count <= COALESCE(?, max_uses)`,
        )
        .bind(
          input.maxUses ?? null,
          input.addUses ?? 0,
          input.revoked === undefined ? null : 1,
          input.revoked ? 1 : 0,
          now,
          now,
          codeId,
          event.id,
          input.maxUses ?? null,
        ),
      prepareAuditLog(db, "user", actor.id, "event_ticket_code_changed", "event", event.id, { codeId, ...input }),
    ])
    .catch((error: unknown) => {
      if (isStateGuardFailure(error))
        throw new AppError(
          409,
          "EVENT_TICKETS_CHANGED",
          "This code was used while you were editing. Reload and try again.",
        );
      throw error;
    });
}
