/**
 * Kicker — the brand's uppercase label device.
 *
 * A decorative uppercase label with an accent dot.
 */

import type { ComponentChildren } from "preact";
import { createElement } from "preact";

import "./Kicker.css";

export interface KickerProps {
  as?: "span" | "p";
  children?: ComponentChildren;
}

export function Kicker({ as = "span", children }: KickerProps) {
  return createElement(as, { class: "pk-kicker" }, children);
}
