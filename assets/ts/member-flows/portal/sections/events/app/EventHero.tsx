/**
 * EventHero — the event app's key visual, scaled for a screen.
 *
 * The conference kit's field gradient with its soft top-left light, the dot
 * grid masked in from the right, the tri-colour mark cropped at the edge, the
 * canal-house outline along the foot, then mono meta, a bold headline and the
 * short stripe under it. One component for every event-app header so the
 * values live in one stylesheet (EventHero.css) and the kit's tokens.
 *
 * The heading is the page's `<h2>` (the shell owns `<h1>`), as in PageHeader.
 *
 * `compact` is the same visual as the header of every other event-app page:
 * a slim field with the way back, the page's own title and the stripe, so a
 * tab reads as part of the same app without repeating the event's name.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import "../../../../../../design/tokens.event.generated.css";
import "./EventHero.css";

export interface EventHeroProps {
  title: ComponentChildren;
  /** The mono line above the title: dates, edition, format. */
  eyebrow?: ComponentChildren;
  /** Where and when, one quiet line each under the stripe. */
  meta?: readonly ComponentChildren[];
  /** A standing such as "Live now" or "Starts in 3 days". */
  status?: { label: string; live?: boolean } | null;
  /** Actions for the whole event, on the field. */
  actions?: ComponentChildren;
  /** The page one level up, as the app's back link. */
  back?: { href: string; label: string };
  /** The slim header of an event-app page other than the event home. */
  compact?: boolean;
}

export function EventHero({ title, eyebrow, meta = [], status, actions, back, compact = false }: EventHeroProps) {
  const headingId = useId();
  return (
    <header class={`pk-event-hero${compact ? " pk-event-hero--compact" : ""}`} aria-labelledby={headingId}>
      <div class="pk-event-hero__field">
        <span class="pk-event-hero__houses" aria-hidden="true" />
        <div class="pk-event-hero__top">
          {back ? (
            <a class="pk-event-hero__back" href={back.href}>
              <span aria-hidden="true">‹</span> {back.label}
            </a>
          ) : null}
          {!compact && <img class="pk-event-hero__logo" src="/img/logo.svg" alt="PKI Consortium" />}
          {status && (
            <span class={`pk-event-hero__status${status.live ? " pk-event-hero__status--live" : ""}`}>
              {status.label}
            </span>
          )}
        </div>
        <div class="pk-event-hero__subject">
          {eyebrow && <p class="pk-event-hero__eyebrow">{eyebrow}</p>}
          <h2 class="pk-event-hero__title" id={headingId}>
            {title}
          </h2>
          <span class="pk-event-hero__bar" aria-hidden="true" />
          {meta.filter(Boolean).map((line, index) => (
            <p key={index} class="pk-event-hero__meta">
              {line}
            </p>
          ))}
          {actions && <div class="pk-event-hero__actions">{actions}</div>}
        </div>
      </div>
      <div class="pk-event-hero__rule" aria-hidden="true" />
    </header>
  );
}
