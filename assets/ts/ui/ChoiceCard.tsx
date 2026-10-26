/**
 * ChoiceCard — one of a few alternatives a reader picks between before a
 * form can go on, each explained by what choosing it means.
 *
 * A plain `Radio` answers a question whose options explain themselves. A
 * choice card is for options whose consequences are the point: an icon, a
 * title, an optional line under it, and a short list of what follows, each
 * point marked as a gain or as a cost.
 *
 * The control is a native radio inside a `<fieldset role="radiogroup">`, so
 * arrow keys move the choice, Tab enters and leaves the group as one stop,
 * and the radio is named by the title and described by the rest of its card.
 * The radio stays visible as the card's mark, so the selection reads by
 * shape as well as by the accent border.
 *
 * Cards sit side by side where there is room and stack on a phone. Like the
 * sign-in methods, they are the one place a full-width choice is right.
 */
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { nextDomId } from "./dom-id";

import { StateIcon } from "./Field";
import { IconCheckmark } from "./MediaIcons";
import "./ChoiceCard.css";

/** Whether a card's points are what the choice gives or what it costs. */
export type ChoicePointTone = "gain" | "cost";

export interface ChoiceCardProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "type" | "class" | "title"> {
  icon: ComponentChildren;
  /** A small mark at the icon's corner, e.g. a caution on the costlier choice. */
  iconMark?: ComponentChildren;
  /** Names the radio. */
  title: ComponentChildren;
  /** A quieter line under the title. */
  description?: ComponentChildren;
  points?: readonly ComponentChildren[];
  pointTone?: ChoicePointTone;
}

export function ChoiceCard({
  icon,
  iconMark,
  title,
  description,
  points = [],
  pointTone = "gain",
  onChange,
  onInput,
  ...rest
}: ChoiceCardProps) {
  const [id] = useState(() => nextDomId("choice"));
  const titleId = `${id}-title`;
  const detailId = `${id}-detail`;
  const hasDetail = Boolean(description) || points.length > 0;
  // As in `Radio`: Preact reconciles a controlled input from `input`, so a
  // caller's `onChange` is answered there, where `checked` is already new.
  const respond: JSX.InputEventHandler<HTMLInputElement> = (event) => {
    onInput?.(event);
    onChange?.(event as unknown as Parameters<NonNullable<typeof onChange>>[0]);
  };

  return (
    <label class={`pk-choice-card pk-choice-card--${pointTone}`}>
      <input
        {...rest}
        type="radio"
        class="pk-check__input pk-choice-card__input"
        aria-labelledby={titleId}
        aria-describedby={hasDetail ? detailId : undefined}
        onInput={respond}
      />
      <span class="pk-choice-card__icon" aria-hidden="true">
        {icon}
        {iconMark && <span class="pk-choice-card__icon-mark">{iconMark}</span>}
      </span>
      <span class="pk-choice-card__title" id={titleId}>
        {title}
      </span>
      {hasDetail && (
        <span class="pk-choice-card__detail" id={detailId}>
          {description && <span class="pk-choice-card__description">{description}</span>}
          {points.length > 0 && (
            <span class={`pk-choice-card__points pk-choice-card__points--${pointTone}`} role="list">
              {points.map((point, index) => (
                <span class="pk-choice-card__point" role="listitem" key={index}>
                  {pointTone === "gain" ? (
                    <IconCheckmark class="pk-choice-card__mark" />
                  ) : (
                    <StateIcon state="advisory" class="pk-choice-card__mark" />
                  )}
                  <span>{point}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

/**
 * The group the cards answer together: a legend, and equal cards that stack on
 * a phone. When the cards' own titles already ask the question, the legend is
 * read to assistive technology only.
 */
export function ChoiceCards({
  legend,
  legendHidden = false,
  children,
}: {
  legend: ComponentChildren;
  legendHidden?: boolean;
  children: ComponentChildren;
}) {
  return (
    <fieldset class="pk-choice-cards" role="radiogroup">
      <legend class={legendHidden ? "pk-sr-only" : "pk-choice-cards__legend"}>{legend}</legend>
      <div class="pk-choice-cards__grid">{children}</div>
    </fieldset>
  );
}
