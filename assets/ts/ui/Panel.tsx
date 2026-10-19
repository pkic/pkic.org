/**
 * Panel — a titled surface, the container for lists and forms.
 *
 * Composed of Panel (container), PanelHeader (with optional heading level),
 * and PanelBody (padded content). Heading level supports nesting without
 * breaking semantic structure.
 */

import type { ComponentChildren, JSX } from "preact";

import "./Panel.css";
import { BreadcrumbBranch } from "./BreadcrumbScope";
import { useSectionHeading } from "./HeadingOutline";

export interface PanelProps extends JSX.HTMLAttributes<HTMLElement> {
  /**
   * Draws the brand rule across the top of the panel.
   *
   * For the one panel on a surface that is the surface's own subject —
   * standing on a member record, the header on a profile. Decoration, so it is
   * hidden from assistive technology; a second panel wearing it makes both
   * mean nothing.
   */
  stripe?: boolean;
  children?: ComponentChildren;
}

export function Panel({ stripe = false, class: className, children, ...rest }: PanelProps) {
  const classes = ["pk-panel", className].filter(Boolean).join(" ");
  return (
    <section class={classes} {...rest}>
      {stripe && <div class="pk-panel__stripe" aria-hidden="true" />}
      {children}
    </section>
  );
}

export interface PanelHeaderProps extends JSX.HTMLAttributes<HTMLElement> {
  title: string;
  /**
   * The authored heading level: 3 for a section of the screen, 4 for a section
   * inside one, and deeper for a panel nested further down. The surface shifts
   * it (see `HeadingOutline`), so in the portal a screen's sections are `<h2>`
   * below its `<h1>` title.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Use this page/form title as the current breadcrumb in a containing workspace. */
  breadcrumb?: boolean;
  /** The panel's ellipsis `Menu`. It sits first in the toolbar, left of the buttons. */
  menu?: ComponentChildren;
  children?: ComponentChildren;
}

export function PanelHeader({
  title,
  headingLevel = 3,
  breadcrumb = false,
  menu,
  class: className,
  children,
  ...rest
}: PanelHeaderProps) {
  const classes = ["pk-panel__header", className].filter(Boolean).join(" ");

  const HeadingTag = useSectionHeading(headingLevel);

  return (
    <header class={classes} {...rest}>
      {breadcrumb && <BreadcrumbBranch items={[{ label: title }]} />}
      <HeadingTag class="pk-panel__title">{title}</HeadingTag>
      {(menu || children) && (
        <div class="pk-panel__toolbar" data-density="compact">
          {menu}
          {children}
        </div>
      )}
    </header>
  );
}

export type PanelBodyTone = "accent" | "ok" | "info" | "warn" | "danger";

export interface PanelBodyProps extends JSX.HTMLAttributes<HTMLDivElement> {
  /**
   * Tints the body, for a panel whose content is a standing rather than a
   * list: what someone has earned, what they are open to.
   *
   * The tone never carries the meaning on its own — the words inside say it —
   * so a reader who cannot see the tint loses nothing.
   */
  tone?: PanelBodyTone;
  /** Tables share the card edge; forms and ordinary content retain padded bodies. */
  flush?: boolean;
  children?: ComponentChildren;
}

export function PanelBody({ tone, flush = false, class: className, children, ...rest }: PanelBodyProps) {
  const classes = [
    "pk-panel__body",
    flush ? "pk-panel__body--flush" : null,
    tone ? `pk-panel__body--${tone}` : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div class={classes} {...rest}>
      {children}
    </div>
  );
}
