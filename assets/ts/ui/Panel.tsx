/**
 * Panel — a titled surface, the container for lists and forms.
 *
 * Composed of Panel (container), PanelHeader (with optional heading level),
 * and PanelBody (padded content). Heading level supports nesting without
 * breaking semantic structure.
 */

import type { ComponentChildren, JSX } from "preact";

import "./Panel.css";

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
  /** The semantic heading level. Defaults to 3 to support nesting. */
  headingLevel?: 2 | 3 | 4;
  children?: ComponentChildren;
}

export function PanelHeader({ title, headingLevel = 3, class: className, children, ...rest }: PanelHeaderProps) {
  const classes = ["pk-panel__header", className].filter(Boolean).join(" ");

  const HeadingTag = `h${headingLevel}` as const as keyof JSX.IntrinsicElements;

  return (
    <header class={classes} {...rest}>
      <HeadingTag class="pk-panel__title">{title}</HeadingTag>
      {children && <div class="pk-panel__toolbar">{children}</div>}
    </header>
  );
}

export type PanelBodyTone = "accent" | "ok" | "info";

export interface PanelBodyProps extends JSX.HTMLAttributes<HTMLDivElement> {
  /**
   * Tints the body, for a panel whose content is a standing rather than a
   * list: what someone has earned, what they are open to.
   *
   * The tone never carries the meaning on its own — the words inside say it —
   * so a reader who cannot see the tint loses nothing.
   */
  tone?: PanelBodyTone;
  children?: ComponentChildren;
}

export function PanelBody({ tone, class: className, children, ...rest }: PanelBodyProps) {
  const classes = ["pk-panel__body", tone ? `pk-panel__body--${tone}` : null, className].filter(Boolean).join(" ");
  return (
    <div class={classes} {...rest}>
      {children}
    </div>
  );
}
