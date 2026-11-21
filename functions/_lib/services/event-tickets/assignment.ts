/**
 * Which ticket a person holds for an event and what it costs them now.
 *
 * Precedence: a code names its ticket; otherwise the decision stored or made
 * for the person's organization; otherwise the person's own choice among the
 * tickets that may be chosen; otherwise the event's default ticket. A person
 * may hold another ticket than the one decided for their organization only
 * by saying why, and an organizer then settles it.
 */
import {
  applyTicketCode,
  quoteTicket,
  type TicketAssignmentSource,
  type TicketQuote,
} from "../../../../assets/shared/event-tickets";
import type { EventTicketQuote } from "../../../../assets/shared/schemas/event-tickets";
import { first } from "../../db/queries";
import { workEmailDomain } from "../../email-domains/classification";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { classifierOptions, decideOrganizationTicket, type StoredTicketDecision } from "./classifier";
import type { EventTicketSnapshot, TicketTypeRow } from "./snapshot";

export interface TicketCodeRow {
  id: string;
  ticket_type_id: string;
  label: string;
  amount: number | null;
  percent_off: number | null;
  max_uses: number;
  used_count: number;
  revoked_at: string | null;
}

export interface TicketPerson {
  userId: string;
  email: string;
  organizationName: string | null;
}

export interface TicketRequest {
  ticketKey?: string | null;
  code?: string | null;
  codeId?: string | null;
  disputeReason?: string | null;
  /** A code the registration already holds: it stays valid for it even when every pass is claimed. */
  heldCodeId?: string | null;
}

export interface ResolvedTicket {
  type: TicketTypeRow;
  source: TicketAssignmentSource;
  code: TicketCodeRow | null;
  /** The ticket decided for the organization, whether or not the person holds it. */
  decision: StoredTicketDecision | null;
  disputeReason: string | null;
}

/** A refusal the registrant's form shows beside the field it is about. */
function fieldRefusal(code: string, field: string, message: string): AppError {
  return new AppError(422, code, message, { fieldErrors: { [field]: [message] } });
}

/** Codes are typed by people: compare them without case, spaces or dashes. */
export function normalizeTicketCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Who a ticket is priced for: the identity the person registers as. Its
 * organization decides the ticket, and its verified address (or the account's
 * own address when the identity has none) decides whether a work address is used.
 */
export async function readTicketPerson(
  db: DatabaseLike,
  input: { userId: string; accountEmail: string; identityId?: string | null },
): Promise<TicketPerson> {
  const row = await first<{ organization_name: string | null; email: string | null }>(
    db,
    `SELECT organization.name AS organization_name,
            (SELECT address.email FROM user_emails address
             WHERE address.id = identity.email_id AND address.verified_at IS NOT NULL) AS email
     FROM identities identity LEFT JOIN organizations organization ON organization.id = identity.organization_id
     WHERE identity.user_id = ?1 AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL
       AND identity.blocked_at IS NULL AND (?2 IS NULL OR identity.id = ?2)
     ORDER BY identity.is_default DESC, identity.started_at DESC, identity.id LIMIT 1`,
    [input.userId, input.identityId ?? null],
  );
  return {
    userId: input.userId,
    email: row?.email ?? input.accountEmail,
    organizationName: row?.organization_name ?? null,
  };
}

/** Tickets a person may hold without a code: those the classifier chooses between, and the default. */
export function selectableTicketTypes(types: readonly TicketTypeRow[]): TicketTypeRow[] {
  const classified = new Set(classifierOptions(types).map((option) => option.key));
  return types.filter((type) => type.active === 1 && (type.is_default === 1 || classified.has(type.ticket_key)));
}

async function readTicketCode(
  db: DatabaseLike,
  eventId: string,
  request: TicketRequest,
): Promise<TicketCodeRow | null> {
  const columns = "id, ticket_type_id, label, amount, percent_off, max_uses, used_count, revoked_at";
  const row = request.codeId
    ? await first<TicketCodeRow>(db, `SELECT ${columns} FROM event_ticket_codes WHERE event_id = ? AND id = ?`, [
        eventId,
        request.codeId,
      ])
    : await first<TicketCodeRow>(db, `SELECT ${columns} FROM event_ticket_codes WHERE event_id = ? AND code = ?`, [
        eventId,
        normalizeTicketCode(request.code ?? ""),
      ]);
  if (!row || row.revoked_at)
    throw fieldRefusal("TICKET_CODE_INVALID", "code", "This code is not valid for this event. Check it and try again.");
  if (row.used_count >= row.max_uses && row.id !== request.heldCodeId)
    throw fieldRefusal(
      "TICKET_CODE_USED_UP",
      "code",
      "This code has no uses left. Ask whoever gave it to you for another one.",
    );
  return row;
}

export async function resolveTicket(
  db: DatabaseLike,
  env: Pick<Env, "AI" | "TICKET_CLASSIFIER_MODEL">,
  event: { id: string },
  snapshot: EventTicketSnapshot,
  person: TicketPerson,
  request: TicketRequest,
): Promise<ResolvedTicket> {
  const active = snapshot.types.filter((type) => type.active === 1);
  if (!active.length) throw new AppError(409, "EVENT_TICKETS_UNAVAILABLE", "This event has no tickets yet.");
  if (request.code?.trim() || request.codeId) {
    const code = await readTicketCode(db, event.id, request);
    const type = active.find((candidate) => candidate.id === code!.ticket_type_id);
    if (!type) throw new AppError(422, "TICKET_CODE_INVALID", "This code is not valid for this event.");
    return { type, source: "code", code, decision: null, disputeReason: null };
  }
  const decision = await decideOrganizationTicket(db, env, active, {
    organizationName: person.organizationName,
    emailDomain: workEmailDomain(person.email),
  });
  const selectable = selectableTicketTypes(active);
  const requested = request.ticketKey
    ? selectable.find((candidate) => candidate.ticket_key === request.ticketKey)
    : undefined;
  if (request.ticketKey && !requested)
    throw new AppError(422, "TICKET_NOT_AVAILABLE", "This ticket needs a code. Enter the code you were given.");
  const decided = decision ? active.find((candidate) => candidate.ticket_key === decision.ticketKey) : undefined;
  if (decided && decision) {
    if (requested && requested.id !== decided.id) {
      const reason = request.disputeReason?.trim();
      if (!reason)
        throw fieldRefusal(
          "TICKET_DISPUTE_REASON_REQUIRED",
          "disputeReason",
          "Say why this ticket fits your organization. The organizers check every change.",
        );
      return { type: requested, source: "disputed", code: null, decision, disputeReason: reason };
    }
    return { type: decided, source: decision.source, code: null, decision, disputeReason: null };
  }
  if (requested) return { type: requested, source: "chosen", code: null, decision: null, disputeReason: null };
  const fallback = active.find((candidate) => candidate.is_default === 1) ?? selectable[0] ?? active[0];
  return { type: fallback, source: "default", code: null, decision: null, disputeReason: null };
}

export interface PricedTicket {
  quote: TicketQuote;
  /** After the code. */
  total: number;
  nextTotal: number | null;
  personalEmailPrice: boolean;
}

/**
 * Prices the day choices. A free ticket that needs a work email address is
 * priced for a personal address at the first period in which it costs money.
 */
export function priceTicket(
  snapshot: EventTicketSnapshot,
  resolved: Pick<ResolvedTicket, "type" | "code">,
  person: Pick<TicketPerson, "email">,
  dayAttendance: ReadonlyArray<{ dayDate: string; attendanceType: string }>,
): PricedTicket {
  const quoteIn = (periodId: string | null) =>
    quoteTicket({ ticketTypeId: resolved.type.id, periodId, prices: snapshot.prices, dayAttendance });
  let quote = quoteIn(snapshot.current?.id ?? null);
  let personalEmailPrice = false;
  if (
    !resolved.code &&
    resolved.type.free_requires_work_email === 1 &&
    quote.subtotal === 0 &&
    !workEmailDomain(person.email)
  ) {
    const later = snapshot.periods
      .filter((period) => period.startsOn !== null && period.startsOn > (snapshot.current?.startsOn ?? ""))
      .sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""))
      .map((period) => quoteIn(period.id))
      .find((candidate) => candidate.subtotal > 0);
    if (later) {
      quote = later;
      personalEmailPrice = true;
    }
  }
  const total = resolved.code
    ? applyTicketCode(quote.subtotal, { amount: resolved.code.amount, percentOff: resolved.code.percent_off })
    : quote.subtotal;
  const next = snapshot.next && !resolved.code && !personalEmailPrice ? quoteIn(snapshot.next.id).subtotal : null;
  return { quote, total, nextTotal: next !== null && next !== total ? next : null, personalEmailPrice };
}

export function ticketQuoteResponse(
  snapshot: EventTicketSnapshot,
  resolved: ResolvedTicket,
  priced: PricedTicket,
): EventTicketQuote {
  return {
    ticketKey: resolved.type.ticket_key,
    ticketName: resolved.type.name,
    source: resolved.source,
    currency: snapshot.settings!.currency,
    lines: priced.quote.lines.map((line) => ({
      attendanceValue: line.attendanceValue,
      dayDates: line.dayDates,
      charged: line.charged,
      amount: line.amount,
      included: line.included,
    })),
    subtotal: priced.quote.subtotal,
    total: priced.total,
    codeLabel: resolved.code?.label ?? null,
    nextTotal: priced.nextTotal,
    nextPeriodStartsOn: priced.nextTotal !== null ? (snapshot.next?.startsOn ?? null) : null,
    personalEmailPrice: priced.personalEmailPrice,
  };
}
