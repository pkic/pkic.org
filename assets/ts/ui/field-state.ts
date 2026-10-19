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
  // Tick, triangle, cross — outlines at the one icon weight, drawn as paths so
  // they take currentColor and scale with the control rather than arriving as
  // three more network requests.
  ok: "M14.5 8a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM5.25 8.25 7 10l3.75-4",
  advisory: "M8 1.75 1.25 13.75h13.5zM8 6.25V9.5M8 11.75h.01",
  invalid: "M14.5 8a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5",
};

const SVG_NS = "http://www.w3.org/2000/svg";

function stateIcon(document: Document, state: FieldState, className: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  // The same frame `StrokeIcon` draws: `pk-icon` takes the shared line weight.
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("pk-icon", className);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", FIELD_STATE_ICON[state]);
  svg.appendChild(path);
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
  else if (className === "pk-field__message-icon") parent.insertBefore(icon, parent.firstChild);
  else parent.appendChild(icon);
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
