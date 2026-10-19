import type { ComponentChildren, JSX } from "preact";
import { NEW_TAB_ATTRIBUTES, NEW_TAB_HINT, isExternalHref } from "./new-tab";

export interface ExternalLinkProps extends JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  /** Overrides the policy: by default a link opens in a new tab when its address leaves the portal. */
  external?: boolean;
  children?: ComponentChildren;
}

/**
 * A text link. A destination outside the portal opens in a new tab and says
 * so to screen readers; anything inside it opens in place.
 */
export function ExternalLink({ external: explicit, children, rel, ...rest }: ExternalLinkProps) {
  const external = explicit ?? isExternalHref(rest.href);
  return external ? (
    <a {...rest} {...NEW_TAB_ATTRIBUTES}>
      {children}
      <span class="pk-sr-only"> {NEW_TAB_HINT}</span>
    </a>
  ) : (
    <a {...rest} rel={rel}>
      {children}
    </a>
  );
}
