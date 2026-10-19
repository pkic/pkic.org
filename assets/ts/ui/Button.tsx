/**
 * Button — the design system's exemplar primitive.
 *
 * Every other primitive follows this shape:
 *
 *   - one co-located `.css` file, imported here, so its styles ride the lazy
 *     chunk that first reaches the component;
 *   - class names under a single `pk-` block, variants as `--modifier`;
 *   - no color, spacing, radius or duration literals — tokens only;
 *   - props typed from a union, not `string`, so an invalid variant is a
 *     compile error rather than a silently unstyled button.
 */

import type { ComponentChildren, JSX } from "preact";

import "./Button.css";

import { buttonClasses, type ButtonLook, type ButtonSize, type ButtonVariant } from "./button-classes";
import { NEW_TAB_ATTRIBUTES, NEW_TAB_HINT, isExternalHref } from "./new-tab";

export type { ButtonSize, ButtonVariant } from "./button-classes";

export interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size" | "loading"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders square, for an icon-only control. Requires `aria-label`. */
  icon?: boolean;
  /**
   * Shows a spinner and blocks activation while keeping the button focusable.
   * A disabled control loses focus, which throws a screen-reader user out of
   * the form they were in the middle of.
   */
  loading?: boolean;
  children?: ComponentChildren;
}

export function Button({
  variant,
  size,
  icon = false,
  loading = false,
  disabled = false,
  type = "button",
  class: className,
  children,
  ...rest
}: ButtonProps) {
  // A form's submit is its affirmative action, so it is primary unless the caller chose otherwise.
  const look = variant ?? (type === "submit" ? "primary" : "secondary");
  const classes = buttonClasses({ variant: look, size, icon }, className);

  const inert = Boolean(disabled) || loading;

  return (
    <button
      {...rest}
      type={type}
      class={classes}
      disabled={Boolean(disabled)}
      aria-disabled={loading ? "true" : undefined}
      aria-busy={loading ? "true" : undefined}
      onClick={inert ? undefined : rest.onClick}
    >
      {loading && <span class="pk-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export interface ButtonLinkProps
  extends Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "size" | "icon">, ButtonLook {
  href: string;
  /** Opens the destination in a new tab and says so to screen readers. Defaults to whether the href leaves the portal. */
  external?: boolean;
  children?: ComponentChildren;
}

/**
 * A link drawn as a button: for a destination, where `Button` is for an
 * action. Same looks, same classes, so a row of the two lines up.
 */
export function ButtonLink({
  variant,
  size,
  icon,
  external: explicit,
  class: className,
  children,
  ...rest
}: ButtonLinkProps) {
  const external = explicit ?? isExternalHref(rest.href);
  return (
    <a {...rest} {...(external ? NEW_TAB_ATTRIBUTES : {})} class={buttonClasses({ variant, size, icon }, className)}>
      {children}
      {external && <span class="pk-sr-only"> {NEW_TAB_HINT}</span>}
    </a>
  );
}
