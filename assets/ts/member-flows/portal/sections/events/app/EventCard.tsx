/**
 * EventCard — one purpose on the event home: a mono eyebrow saying what the
 * card is for, a title, and its content. Built on Panel so it keeps the
 * portal's surface, border and dark-mode tokens; the event app only tightens
 * the corner and adds the kit's eyebrow (EventApp.css).
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { Panel, PanelBody } from "../../../../../ui/Panel";
import "./EventApp.css";

export function EventCard({
  eyebrow,
  title,
  children,
  live = false,
}: {
  eyebrow: string;
  title?: ComponentChildren;
  children?: ComponentChildren;
  /** Marks a card about something happening now. */
  live?: boolean;
}) {
  const id = useId();
  return (
    <Panel class={`pk-event-card${live ? " pk-event-card--live" : ""}`} aria-labelledby={id}>
      <PanelBody class="pk-stack pk-stack--snug">
        <p class="pk-event-card__eyebrow" id={title ? undefined : id}>
          {eyebrow}
        </p>
        {title && (
          <h3 class="pk-event-card__title" id={id}>
            {title}
          </h3>
        )}
        {children}
      </PanelBody>
    </Panel>
  );
}
