/**
 * TicketCard — one ticket a person can hold for an event, drawn as a ticket:
 * what it is and who it is for on the body, the price on the stub.
 *
 * With `name` it is one radio in a `TicketChoice` group. Without it the card
 * states the ticket the person already has, with `reason` saying why.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Radio } from "../../../ui/Checkbox";
import { nextDomId } from "../../../ui/dom-id";
import { Markdown } from "../../../ui/Markdown";
import "./TicketCard.css";

export interface TicketCardProps {
  title: string;
  /** Basic Markdown: a sentence, a short list, bold. */
  description: string;
  /** The price as shown: "Free" or "$395"; the lowest one when the price depends on how the person attends. */
  price: string;
  /** The highest price, when the price depends on how the person attends: the stub then shows the range. */
  priceTo?: string;
  /** How long the price holds: "until Mar 19, 2027". */
  priceTerms?: string;
  /** What follows: "then $195". */
  priceNext?: string;
  /** Present when the card is a choice. */
  name?: string;
  value?: string;
  checked?: boolean;
  onSelect?: () => void;
  /** Why the person holds this ticket, when it was decided for them. */
  reason?: ComponentChildren;
  /** The ticket's condition as fine print: a few words, the way a printed ticket states its terms. */
  note?: ComponentChildren;
}

export function TicketCard({
  title,
  description,
  price,
  priceTo,
  priceTerms,
  priceNext,
  name,
  value,
  checked,
  onSelect,
  reason,
  note,
}: TicketCardProps) {
  const [id] = useState(() => nextDomId("ticket"));
  const choice = name !== undefined;
  return (
    <div class="pk-ticket" data-assigned={choice ? undefined : ""}>
      <div class="pk-ticket__body">
        {choice ? (
          <Radio
            class="pk-ticket__choice"
            name={name}
            value={value}
            checked={checked}
            aria-describedby={`${id}-detail ${id}-price`}
            label={<span class="pk-ticket__title">{title}</span>}
            onChange={onSelect}
          />
        ) : (
          <span class="pk-ticket__heading">
            <span class="pk-ticket__kicker">Your ticket</span>
            <strong class="pk-ticket__title">{title}</strong>
          </span>
        )}
        <div class="pk-ticket__detail" id={`${id}-detail`}>
          <Markdown markdown={description} />
          {reason && <p class="pk-ticket__reason">{reason}</p>}
        </div>
        {note && <p class="pk-ticket__fineprint">{note}</p>}
      </div>
      <div class="pk-ticket__stub" id={`${id}-price`}>
        {priceTo ? (
          <span class="pk-ticket__price pk-ticket__price--range">
            <span>{price}</span>{" "}
            <span>
              <small>to</small> {priceTo}
            </span>
          </span>
        ) : (
          <span class="pk-ticket__price">{price}</span>
        )}
        {priceTerms && <span class="pk-ticket__terms">{priceTerms}</span>}
        {priceNext && <span class="pk-ticket__next">{priceNext}</span>}
      </div>
    </div>
  );
}

/** The tickets a person chooses between, as one radio group. */
export function TicketChoice({
  legend,
  intro,
  footnote,
  children,
}: {
  legend: string;
  /** The event's own guidance on choosing, under the legend. */
  intro?: string;
  /** One line that holds for every ticket in the group, such as when prices change. */
  footnote?: string;
  children: ComponentChildren;
}) {
  return (
    <fieldset class="pk-ticket-choice" role="radiogroup">
      <legend class="pk-ticket-choice__legend">{legend}</legend>
      {intro && <p class="pk-ticket-choice__intro">{intro}</p>}
      <div class="pk-ticket-choice__list">{children}</div>
      {footnote && <p class="pk-ticket-choice__footnote">{footnote}</p>}
    </fieldset>
  );
}
