/**
 * What a signed-in person sees before registering: the ticket decided for
 * them or the tickets they may choose between, each with today's prices, and
 * the price of their own day choices.
 */
import type {
  EventTicketOffer,
  EventTicketQuote,
  EventTicketQuoteRequest,
} from "../../../../assets/shared/schemas/event-tickets";
import { workEmailDomain } from "../../email-domains/classification";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import {
  priceTicket,
  readTicketPerson,
  resolveTicket,
  selectableTicketTypes,
  ticketQuoteResponse,
  type TicketPerson,
} from "./assignment";
import { decideOrganizationTicket } from "./classifier";
import { eventSellsTickets, readEventTicketSnapshot, type EventTicketSnapshot, type TicketTypeRow } from "./snapshot";

type ClassifierEnv = Pick<Env, "AI" | "TICKET_CLASSIFIER_MODEL">;
interface EventRef {
  id: string;
  timezone: string;
}

function ticketPerson(
  db: DatabaseLike,
  identity: { userId: string; email: string },
  identityId?: string | null,
): Promise<TicketPerson> {
  return readTicketPerson(db, { userId: identity.userId, accountEmail: identity.email, identityId });
}

/** The offer for someone who is not signed in: no ticket is shown before registration. */
export function guestTicketOffer(event: EventRef): EventTicketOffer {
  return {
    enabled: false,
    currency: "usd",
    timeZone: event.timezone,
    assigned: null,
    currentPeriodStartsOn: null,
    nextPeriodStartsOn: null,
    sendInvoice: false,
    ticketIntro: "",
    attendanceIntro: "",
    personalEmail: false,
    tickets: [],
  };
}

/**
 * What each price of a ticket that is free only for work addresses costs a
 * personal mailbox: the amount in the first later period in which that price
 * is paid. A price that costs money now, or never does, has no such amount.
 */
function personalEmailAmounts(snapshot: EventTicketSnapshot, type: TicketTypeRow): Map<string, number> {
  const amounts = new Map<string, number>();
  if (type.free_requires_work_email !== 1) return amounts;
  const currentId = snapshot.current?.id ?? null;
  const later = snapshot.periods
    .filter((period) => period.startsOn !== null && period.startsOn > (snapshot.current?.startsOn ?? ""))
    .sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));
  for (const price of snapshot.prices) {
    if (price.ticketTypeId !== type.id) continue;
    if ((currentId && price.amounts[currentId]) || 0) continue;
    const paid = later.map((period) => price.amounts[period.id] ?? 0).find((value) => value > 0);
    if (paid !== undefined) amounts.set(priceRowKey(price), paid);
  }
  return amounts;
}

const priceRowKey = (price: { attendanceValue: string; dayDate: string | null }) =>
  `${price.attendanceValue}:${price.dayDate ?? ""}`;

export async function readEventTicketOffer(
  db: DatabaseLike,
  env: ClassifierEnv,
  event: EventRef,
  identity: { userId: string; email: string },
  identityId?: string | null,
): Promise<EventTicketOffer> {
  const snapshot = await readEventTicketSnapshot(db, event);
  if (!eventSellsTickets(snapshot)) return guestTicketOffer(event);
  const person = await ticketPerson(db, identity, identityId);
  const active = snapshot.types.filter((type) => type.active === 1);
  const decision = await decideOrganizationTicket(db, env, active, {
    organizationName: person.organizationName,
    emailDomain: workEmailDomain(person.email),
  });
  const selectable = selectableTicketTypes(active);
  const currentId = snapshot.current?.id ?? null;
  const nextId = snapshot.next?.id ?? null;
  return {
    enabled: true,
    currency: snapshot.settings!.currency,
    timeZone: event.timezone,
    assigned:
      decision && active.some((type) => type.ticket_key === decision.ticketKey)
        ? { ticketKey: decision.ticketKey, source: decision.source, organizationName: person.organizationName }
        : null,
    currentPeriodStartsOn: snapshot.current?.startsOn ?? null,
    nextPeriodStartsOn: snapshot.next?.startsOn ?? null,
    sendInvoice: snapshot.settings!.send_invoice === 1,
    ticketIntro: snapshot.settings!.ticket_intro ?? "",
    attendanceIntro: snapshot.settings!.attendance_intro ?? "",
    personalEmail: !workEmailDomain(person.email),
    tickets: active.map((type) => {
      const personal = personalEmailAmounts(snapshot, type);
      return {
        key: type.ticket_key,
        name: type.name,
        descriptionMarkdown: type.description_markdown,
        personalEmailAmount: personal.size > 0 ? Math.max(...personal.values()) : null,
        selectable: selectable.some((candidate) => candidate.id === type.id),
        prices: snapshot.prices
          .filter((price) => price.ticketTypeId === type.id)
          .map((price) => ({
            attendanceValue: price.attendanceValue,
            dayDate: price.dayDate,
            charged: price.charged,
            amount: (currentId && price.amounts[currentId]) || 0,
            nextAmount: nextId ? (price.amounts[nextId] ?? 0) : null,
            personalEmailAmount: personal.get(priceRowKey(price)) ?? null,
          })),
      };
    }),
  };
}

/** Prices the person's day choices, and with `save` keeps their ticket, code or dispute for the registration that follows. */
export async function quoteEventTicket(
  db: DatabaseLike,
  env: ClassifierEnv,
  event: EventRef,
  identity: { userId: string; email: string },
  request: EventTicketQuoteRequest,
): Promise<EventTicketQuote> {
  const snapshot = await readEventTicketSnapshot(db, event);
  if (!eventSellsTickets(snapshot)) throw new AppError(409, "EVENT_TICKETS_UNAVAILABLE", "This event has no tickets.");
  const person = await ticketPerson(db, identity, request.identityId);
  const resolved = await resolveTicket(db, env, event, snapshot, person, request);
  const priced = priceTicket(snapshot, resolved, person, request.dayAttendance);
  if (request.save) {
    const chosen = resolved.source === "chosen" || resolved.source === "disputed";
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_ticket_selections (event_id, user_id, ticket_type_id, code_id, dispute_reason, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id, user_id) DO UPDATE SET ticket_type_id = excluded.ticket_type_id,
             code_id = excluded.code_id, dispute_reason = excluded.dispute_reason, updated_at = excluded.updated_at`,
        )
        .bind(
          event.id,
          identity.userId,
          chosen ? resolved.type.id : null,
          resolved.code?.id ?? null,
          resolved.disputeReason,
          nowIso(),
        ),
    ]);
  }
  return ticketQuoteResponse(snapshot, resolved, priced);
}
