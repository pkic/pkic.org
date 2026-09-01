/**
 * Button — the design system's exemplar primitive.
 *
 * Every other primitive follows this shape:
 *
 *   - one co-located `.css` file, imported here, so its styles ride the lazy
 *     chunk that first reaches the component;
 *   - class names under a single `pk-` block, variants as `--modifier`;
 *   - no colour, spacing, radius or duration literals — tokens only;
 *   - props typed from a union, not `string`, so an invalid variant is a
 *     compile error rather than a silently unstyled button.
 */

import type { ComponentChildren, JSX } from "preact";

import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet" | "link";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size" | "loading"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders square, for an icon-only control. Requires `aria-label`. */
  icon?: boolean;
  block?: boolean;
  /**
   * Shows a spinner and blocks activation while keeping the button focusable.
   * A disabled control loses focus, which throws a screen-reader user out of
   * the form they were in the middle of.
   */
  loading?: boolean;
  children?: ComponentChildren;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon = false,
  block = false,
  loading = false,
  disabled = false,
  type = "button",
  class: className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "pk-btn",
    `pk-btn--${variant}`,
    size === "md" ? null : `pk-btn--${size}`,
    icon ? "pk-btn--icon" : null,
    block ? "pk-btn--block" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const inert = Boolean(disabled) || loading;

  return (
    <button
      {...rest}
      type={type}
      class={classes}
      disabled={Boolean(disabled)}
      aria-disabled={inert ? "true" : undefined}
      aria-busy={loading ? "true" : undefined}
      onClick={inert ? undefined : rest.onClick}
    >
      {loading && <span class="pk-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
