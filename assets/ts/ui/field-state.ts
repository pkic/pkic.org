/**
 * The three validation states, shared by the Preact `Field` and by the
 * server-rendered forms the validators drive.
 *
 * Both have to draw the same thing. `Field` builds the state into its render;
 * a Hugo template ships a static `pk-field` and the validator moves it between
 * states afterwards. Keeping the vocabulary, the icon geometry and the class
 * names in one module is what stops the two drifting — a form whose markup is
 * correct but whose script never sets a modifier looks unstyled, which is the
 * failure this module exists to prevent.
 */

export type FieldState = "ok" | "advisory" | "invalid";

export const FIELD_STATES: readonly FieldState[] = ["ok", "advisory", "invalid"];

export const FIELD_STATE_ICON: Record<FieldState, string> = {
  // Tick, triangle, cross — drawn as paths so they take currentColor and scale
  // with the control rather than arriving as three more network requests.
  ok: "M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-4.03-2.97a.75.75 0 0 0-1.08.02L7.48 9.4 5.7 7.6a.75.75 0 1 0-1.06 1.06l2.35 2.35a.75.75 0 0 0 1.08-.02l3.92-4.9a.75.75 0 0 0-.02-1.06",
  advisory:
    "M8.98 1.57a1.13 1.13 0 0 0-1.96 0L.16 13.23c-.45.78.1 1.77.99 1.77h13.71c.89 0 1.44-.99.98-1.77zM8 5c.54 0 .95.46.9 1l-.35 3.5a.55.55 0 0 1-1.1 0L7.1 6A.9.9 0 0 1 8 5m0 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2",
  invalid:
    "M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.35 4.29a.75.75 0 0 0-1.06 1.06L6.94 8l-2.65 2.65a.75.75 0 1 0 1.06 1.06L8 9.06l2.65 2.65a.75.75 0 0 0 1.06-1.06L9.06 8l2.65-2.65a.75.75 0 0 0-1.06-1.06L8 6.94z",
};

const SVG_NS = "http://www.w3.org/2000/svg";

function stateIcon(document: Document, state: FieldState, className: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add(className);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", FIELD_STATE_ICON[state]);
  svg.append(path);
  return svg;
}

/** Replaces the mark inside `parent`, or removes it when `state` is null. */
function syncIcon(parent: Element | null, state: FieldState | null, className: string): void {
  if (!parent) return;
  const existing = parent.querySelector(`.${className}`);
  if (!state) {
    existing?.remove();
    return;
  }
  const icon = stateIcon(parent.ownerDocument, state, className);
  if (existing) existing.replaceWith(icon);
  // The message reads "<mark> text", the control "…value <mark>".
  else if (className === "pk-field__message-icon") parent.prepend(icon);
  else parent.append(icon);
}

/**
 * Moves a server-rendered `pk-field` into a validation state.
 *
 * Only the modifier carries the `--state-*` variables, so this must land on the
 * `pk-field` itself: setting it on a wrapper further out styles nothing.
 */
export function applyFieldState(field: Element | null, state: FieldState | null): void {
  if (!field) return;
  for (const candidate of FIELD_STATES) {
    field.classList.toggle(`pk-field--${candidate}`, candidate === state);
  }
  syncIcon(field.querySelector(".pk-field__control"), state, "pk-field__state");
  syncIcon(field.querySelector(".pk-field__message"), state, "pk-field__message-icon");
}
