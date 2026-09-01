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
  children?: ComponentChildren;
}

export function Panel({ class: className, children, ...rest }: PanelProps) {
  const classes = ["pk-panel", className].filter(Boolean).join(" ");
  return (
    <section class={classes} {...rest}>
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

export interface PanelBodyProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children?: ComponentChildren;
}

export function PanelBody({ class: className, children, ...rest }: PanelBodyProps) {
  const classes = ["pk-panel__body", className].filter(Boolean).join(" ");
  return (
    <div class={classes} {...rest}>
      {children}
    </div>
  );
}
