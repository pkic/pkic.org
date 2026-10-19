/**
 * ActionTile — an icon over a label, optionally with a one-line hint, as a
 * comfortably large touch target in a grid of equal tiles.
 *
 * The event app's destinations and the calendar choices are the same job: a
 * handful of places or actions a reader picks between with a thumb. A tile is
 * a link when it goes somewhere and a button when it acts in place.
 */
import type { ComponentChildren, JSX } from "preact";

import "./ActionTile.css";

type TileAttributes = Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "icon" | "label">;

export interface ActionTileProps extends TileAttributes {
  icon: ComponentChildren;
  label: ComponentChildren;
  hint?: ComponentChildren;
  /** A link when present; otherwise a button that acts through `onClick`. */
  href?: string;
  target?: string;
  rel?: string;
  disabled?: boolean;
}

export function ActionTile({ icon, label, hint, href, disabled, ...rest }: ActionTileProps) {
  const content = (
    <>
      <span class="pk-action-tile__icon" aria-hidden="true">
        {icon}
      </span>
      <span class="pk-action-tile__label">{label}</span>
      {hint ? <span class="pk-action-tile__hint">{hint}</span> : null}
    </>
  );
  if (href)
    return (
      <a class="pk-action-tile" href={href} {...(rest as JSX.HTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    );
  return (
    <button
      type="button"
      class="pk-action-tile"
      disabled={disabled}
      {...(rest as JSX.HTMLAttributes<HTMLButtonElement>)}
    >
      {content}
    </button>
  );
}

/** The grid tiles sit in: equal columns that wrap, each tile its column's width. */
export function ActionTiles({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <ul class="pk-action-tiles" aria-label={label}>
      {children}
    </ul>
  );
}
