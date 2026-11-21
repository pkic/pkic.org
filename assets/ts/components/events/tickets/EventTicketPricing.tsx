/**
 * Puts a ticket and its price around the attendance grid of a registration.
 *
 * The ticket leads: the one decided for the person's organization, or the
 * tickets they may choose between. The grid then says what each way of
 * attending costs with it, and the order below adds up the days chosen.
 * Every change is priced by the server and kept for the registration that
 * follows, so what is shown is what is charged.
 */
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  eventTicketOfferSchema,
  eventTicketQuoteRequestSchema,
  eventTicketQuoteSchema,
  type EventTicketOffer,
  type EventTicketQuote,
  type EventTicketQuoteRequest,
} from "../../../../shared/schemas/event-tickets";
import { formatTicketAmount, ticketRefundNote } from "../../../../shared/event-ticket-display";
import { formatCalendarDate, formatZoneCity } from "../../../../shared/format-date";
import { dayBefore } from "../../../../shared/event-ticket-display";
import { useContractForm } from "../../../hooks/useContractForm";
import { useData } from "../../../hooks/useData";
import { getJson, postJson } from "../../../shared/api-client";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { InputGroup } from "../../../ui/InputGroup";
import { IconClock } from "../../../ui/MediaIcons";
import { TextInput, Textarea } from "../../../ui/TextControl";
import { AttendancePricingContext, PricingChoiceRequiredError, type AttendancePricing } from "../../attendance-pricing";
import { TicketCard, TicketChoice } from "./TicketCard";
import { attendanceOptionPrices, ticketStubPrice, type OfferedTicket } from "./ticket-price-summary";

/** "11:59 pm Amsterdam time": when the last day of a price ends, named by the event's zone. */
function deadlineClock(timeZone: string): string {
  return `11:59 pm ${formatZoneCity(timeZone)} time`;
}

/** A ticket's work-address condition as fine print. A personal address sees how to meet it; a work address meets it. */
function personalEmailNote(offer: EventTicketOffer, ticket: OfferedTicket): ComponentChildren {
  if (ticket.personalEmailAmount === null) return undefined;
  return offer.personalEmail ? (
    <>
      Free with a work email address ·{" "}
      <Button type="button" variant="link" data-step-jump="1">
        Use a work address
      </Button>
    </>
  ) : (
    "Work email address required"
  );
}

export function EventTicketPricing({ slug, children }: { slug: string; children: ComponentChildren }) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/tickets`;
  // The identity chosen on the flow's first step decides the ticket and whether a work address is used.
  // The registration form renders inside this host, so its identity field is read from here.
  const host = useRef<HTMLDivElement>(null);
  const [identityId, setIdentityId] = useState("");
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const read = () => {
      const field = element.querySelector('[name="identityId"]');
      setIdentityId(field instanceof HTMLInputElement || field instanceof HTMLSelectElement ? field.value : "");
    };
    read();
    element.addEventListener("change", read);
    element.addEventListener("click", read);
    return () => {
      element.removeEventListener("change", read);
      element.removeEventListener("click", read);
    };
  }, []);
  const offer = useData(
    () =>
      getJson(
        `${endpoint}/offer${identityId ? `?identityId=${encodeURIComponent(identityId)}` : ""}`,
        eventTicketOfferSchema,
      ),
    [slug, identityId],
  );
  const enabled = offer.data?.enabled ?? false;
  const [chosen, setChosen] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>({});
  const [quote, setQuote] = useState<EventTicketQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  // Saves reach the server one at a time and in order, so an older choice never lands after a newer one.
  const saves = useRef<Promise<void>>(Promise.resolve());
  // The request for what is on screen now, known the moment it renders.
  const latest = useRef<{ key: string; request: EventTicketQuoteRequest } | null>(null);

  const selectable = useMemo(() => offer.data?.tickets.filter((ticket) => ticket.selectable) ?? [], [offer.data]);
  const assignedKey = offer.data?.assigned?.ticketKey ?? null;
  // Nothing is chosen for the person: with more than one ticket to choose from, they pick one themselves.
  const mustChoose = !assignedKey && selectable.length > 1 && !chosen && !code;
  const activeKey = mustChoose
    ? null
    : // A code decides its own ticket; otherwise the ticket the person picked is the one shown as chosen.
      ((code ? quote?.ticketKey : null) ??
      chosen ??
      quote?.ticketKey ??
      assignedKey ??
      (selectable.length === 1 ? selectable[0].key : null));
  const activeTicket = offer.data?.tickets.find((ticket) => ticket.key === activeKey);
  const disputed = Boolean(assignedKey && chosen && chosen !== assignedKey);
  const dayAttendance = useMemo(
    () =>
      Object.entries(selection)
        .filter(([, attendanceType]) => attendanceType)
        .map(([dayDate, attendanceType]) => ({ dayDate, attendanceType })),
    [selection],
  );
  // The same contract the quote route parses marks the code and the reason beside their fields.
  const form = useContractForm(eventTicketQuoteRequestSchema, {
    dayAttendance,
    code: codeInput.trim() || undefined,
    disputeReason: reason.trim() || undefined,
    save: true,
  });
  const refuse = useRef(form.refuse);
  refuse.current = form.refuse;
  const check = useRef(form.submit);
  check.current = form.submit;

  // A dispute is only sent once it has a reason; until then the decided ticket is priced.
  const request = useMemo(() => {
    if (!enabled || mustChoose) return null;
    const ticketKey = disputed && !reason.trim() ? undefined : (chosen ?? undefined);
    // A value the contract refuses, such as a code that is too long, is shown beside its field; it is not a request.
    const parsed = eventTicketQuoteRequestSchema.safeParse({
      dayAttendance,
      ticketKey: code ? undefined : ticketKey,
      code: code || undefined,
      disputeReason: disputed && reason.trim() ? reason.trim() : undefined,
      identityId: identityId || undefined,
      save: true,
    });
    return parsed.success ? parsed.data : null;
  }, [enabled, dayAttendance, chosen, code, disputed, reason, mustChoose, identityId]);
  latest.current = request ? { key: JSON.stringify(request), request } : null;

  /** Keeps one choice on the server, after every save before it. Rejects when the server did not keep it. */
  const save = useCallback(
    (entry: { key: string; request: EventTicketQuoteRequest }) => {
      const run = saves.current.then(async () => {
        try {
          const result = await postJson(`${endpoint}/quote`, entry.request, eventTicketQuoteSchema);
          if (latest.current?.key !== entry.key) return;
          setQuote(result);
          setQuoteError("");
        } catch (error) {
          if (latest.current?.key === entry.key) {
            const message = refuse.current(error);
            // A refused code is dropped so the person keeps a price for the ticket they had.
            if (entry.request.code) setCode("");
            else setQuoteError(message);
          }
          throw error;
        }
      });
      saves.current = run.catch(() => undefined);
      return run;
    },
    [endpoint],
  );
  // What the registration waits for: the choice on screen now is kept, or the registration does not go ahead.
  // The choice is sent again even when this page already saved it: the server keeps one choice for a person and
  // event, so another tab may have replaced it. With no choice to keep, or one the contract refuses, it rejects.
  const needsChoice = useRef(false);
  needsChoice.current = enabled && !request;
  const settle = useCallback(async () => {
    // What is typed but not applied yet is checked too: a code or reason the contract refuses is marked beside
    // its field, and the registration is not made as if it had not been entered.
    const draft = check.current();
    if (!draft.data) throw new PricingChoiceRequiredError(draft.formMessage ?? "Check the code you entered.");
    if (needsChoice.current) throw new PricingChoiceRequiredError("Choose a ticket, and check any code you entered.");
    if (latest.current) await save(latest.current);
  }, [save]);

  const requestKey = latest.current?.key ?? null;
  useEffect(() => {
    if (!enabled) return;
    if (!requestKey) return setQuote(null);
    const timer = setTimeout(() => {
      const entry = latest.current;
      if (entry?.key === requestKey) save(entry).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [enabled, requestKey, save]);

  const onSelection = useCallback((selected: Readonly<Record<string, string>>) => setSelection(selected), []);

  const pricing = ((): AttendancePricing | null => {
    const data = offer.data;
    if (!data?.enabled) return null;
    const card = (ticket: OfferedTicket, extra: Partial<Parameters<typeof TicketCard>[0]> = {}) => (
      <TicketCard
        key={ticket.key}
        title={ticket.name}
        description={ticket.descriptionMarkdown}
        note={personalEmailNote(data, ticket)}
        {...ticketStubPrice(data, ticket)}
        {...extra}
      />
    );
    const choice = (legend: string) => (
      <TicketChoice
        legend={legend}
        intro={data.ticketIntro || undefined}
        footnote={
          data.nextPeriodStartsOn
            ? `Prices hold until ${deadlineClock(data.timeZone)} on ${formatCalendarDate(dayBefore(data.nextPeriodStartsOn))}.`
            : undefined
        }
      >
        {selectable.map((ticket) =>
          card(ticket, {
            name: "eventTicket",
            value: ticket.key,
            checked: ticket.key === activeKey,
            onSelect: () => setChosen(ticket.key),
          }),
        )}
      </TicketChoice>
    );
    let above: ComponentChildren;
    if (quote?.source === "code" && activeTicket)
      above = card(activeTicket, {
        // A code prices the days chosen. Before a day is chosen there is no amount to state, and a free
        // code's ticket never shows a price it will not cost.
        price: dayAttendance.length > 0 ? formatTicketAmount(quote.total, data.currency) : "",
        priceTo: undefined,
        priceTerms: "with your code",
        priceNext: undefined,
        note: undefined,
        reason: (
          <>
            Your code for {quote.codeLabel} gives you this ticket.
            {dayAttendance.length > 0 ? "" : " Choose your days to see your price."}
          </>
        ),
      });
    else if (data.assigned && !disputing) {
      const assigned = data.tickets.find((ticket) => ticket.key === data.assigned!.ticketKey);
      above = assigned ? (
        <div class="pk-stack pk-stack--tight">
          {card(assigned, {
            reason: data.assigned.organizationName ? (
              <>
                Based on your organization, <strong>{data.assigned.organizationName}</strong>.
              </>
            ) : (
              "Based on your organization."
            ),
          })}
          {selectable.length > 1 && (
            <div>
              <Button type="button" variant="link" onClick={() => setDisputing(true)}>
                This ticket isn't right for my organization
              </Button>
            </div>
          )}
        </div>
      ) : null;
    } else if (data.assigned)
      above = (
        <div class="pk-stack">
          {choice("Choose the ticket that fits your organization")}
          {disputed && (
            <>
              <Alert tone="warn" title="The organizers check every change">
                If the ticket you choose doesn't fit your organization, it can be withdrawn or you can be asked to pay
                the difference.
              </Alert>
              <Field
                {...form.of("disputeReason")}
                label="Why this ticket fits your organization"
                help="One or two sentences on what your organization does."
                required
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="disputeReason"
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    onInput={(event) => setReason(event.currentTarget.value)}
                  />
                )}
              </Field>
            </>
          )}
          <div>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setDisputing(false);
                setChosen(null);
                setReason("");
              }}
            >
              Keep the ticket chosen for my organization
            </Button>
          </div>
        </div>
      );
    else above = selectable.length > 1 ? choice("Choose your ticket") : activeTicket ? card(activeTicket) : null;

    if (data.attendanceIntro)
      above = (
        <div class="pk-stack pk-stack--loose">
          {above}
          <p class="pk-strong">{data.attendanceIntro}</p>
        </div>
      );

    const applyCode = () => {
      const entered = codeInput.trim();
      if (entered) setCode(entered);
    };
    // An event where nothing costs money has no order to add up. Its code field stays only when a
    // code can lead to another ticket; with a single free ticket there is nothing below the grid.
    const anyPaid = data.tickets.some(
      (ticket) =>
        ticket.personalEmailAmount !== null ||
        ticket.prices.some((price) => price.amount > 0 || (price.nextAmount ?? 0) > 0),
    );
    const showOrder = anyPaid || (quote?.total ?? 0) > 0 || quote?.source === "code";
    const below =
      !showOrder && data.tickets.length < 2 ? undefined : (
        <div class="pk-ticket-order" {...form.handlers}>
          {quote && showOrder && dayAttendance.length > 0 && (
            <dl class="pk-ticket-order__lines">
              <div class="pk-ticket-order__line">
                <dt>
                  {quote.ticketName} ticket
                  {quote.personalEmailPrice && <small>Price for a personal email address</small>}
                  {quote.codeLabel && quote.total === 0 && <small>Code: {quote.codeLabel}</small>}
                </dt>
                {/* A free ticket reads as free: it never shows a price that is then taken off. */}
                <dd>{formatTicketAmount(quote.total === 0 ? 0 : quote.subtotal, quote.currency)}</dd>
              </div>
              {quote.codeLabel && quote.total > 0 && quote.total < quote.subtotal && (
                <div class="pk-ticket-order__line">
                  <dt>Code: {quote.codeLabel}</dt>
                  <dd>−{formatTicketAmount(quote.subtotal - quote.total, quote.currency)}</dd>
                </div>
              )}
              <div class="pk-ticket-order__line pk-ticket-order__total">
                <dt>Total</dt>
                <dd>{formatTicketAmount(quote.total, quote.currency)}</dd>
              </div>
            </dl>
          )}
          {mustChoose && showOrder && <p class="pk-muted">Choose a ticket to see your price.</p>}
          {quote && showOrder && dayAttendance.length === 0 && (
            <p class="pk-muted">Choose your days to see your price.</p>
          )}
          {quote && dayAttendance.length > 0 && quote.nextTotal !== null && quote.nextPeriodStartsOn && (
            <p class="pk-ticket-order__deadline">
              <IconClock width="16" height="16" />
              Register by {formatCalendarDate(dayBefore(quote.nextPeriodStartsOn))} to{" "}
              {quote.total === 0 ? "get this ticket free" : `pay ${formatTicketAmount(quote.total, quote.currency)}`}.
              New registrations from {formatCalendarDate(quote.nextPeriodStartsOn)} are{" "}
              {formatTicketAmount(quote.nextTotal, quote.currency)}.
            </p>
          )}
          {quote?.personalEmailPrice && (
            <p class="pk-ticket-order__switch">
              <strong>This ticket is free with a work email address.</strong> Go back one step to add your organization
              to your account, then register as its representative. You keep the same account.
            </p>
          )}
          {quote && quote.total > 0 && (
            <p class="pk-small pk-muted">
              You pay on the next page after you register. Your place is confirmed once the payment arrives.
              {data.sendInvoice
                ? " You get an invoice by email after payment."
                : " You get a receipt by email after payment, not an invoice."}{" "}
              {ticketRefundNote(data, data.timeZone)}
            </p>
          )}
          {quoteError && <Alert tone="danger">{quoteError}</Alert>}
          {quote?.source === "code" ? (
            <div>
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  setCode("");
                  setCodeInput("");
                }}
              >
                Remove the code
              </Button>
            </div>
          ) : (
            <Field
              {...form.of("code")}
              label="Sponsor or partner code"
              help="A sponsor or partner code sets your ticket type and price."
            >
              {(control) => (
                <InputGroup>
                  <TextInput
                    {...control}
                    name="code"
                    autocomplete="off"
                    value={codeInput}
                    onInput={(event) => setCodeInput(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      // Enter applies the code; it must not submit the registration around it.
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      applyCode();
                    }}
                  />
                  <Button type="button" onClick={applyCode}>
                    Apply code
                  </Button>
                </InputGroup>
              )}
            </Field>
          )}
        </div>
      );
    return {
      above,
      below,
      optionPrices: {
        ...attendanceOptionPrices(data, activeTicket ? [activeTicket] : selectable),
        // A way of attending that the higher event price already covers says so in place of its price.
        ...Object.fromEntries(
          (quote?.lines ?? [])
            .filter((line) => line.included)
            .map((line) => [line.attendanceValue, { amount: "Included" }]),
        ),
      },
      priceHeading: activeTicket ? `${activeTicket.name} ticket` : "Price",
      reviewItems: quote
        ? [
            {
              term: "Ticket",
              value: quote.codeLabel ? `${quote.ticketName} · code ${quote.codeLabel}` : quote.ticketName,
            },
            // An event where nothing costs money states no total, as on the attendance step.
            ...(showOrder && dayAttendance.length > 0
              ? [{ term: "Total", value: formatTicketAmount(quote.total, quote.currency) }]
              : []),
          ]
        : undefined,
      onSelection,
      settle,
    };
  })();

  return (
    <AttendancePricingContext.Provider value={pricing}>
      <div ref={host}>{children}</div>
    </AttendancePricingContext.Provider>
  );
}
