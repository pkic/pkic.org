/**
 * The busy state of a server-rendered `pk-btn`, for pages that drive their
 * controls imperatively rather than through the design system's `Button`.
 *
 * It writes exactly what `<Button loading>` renders — `aria-busy` and
 * `aria-disabled` on the button and a leading `pk-btn__spinner` — so a busy
 * control looks and announces the same on every page. Like `Button`, it keeps
 * the control focusable and blocks activation instead of disabling it: a
 * disabled control loses focus and throws a screen-reader user out of the
 * form they were in the middle of.
 */
import "../../ui/Button.css";

const SPINNER_MARKER = "data-busy-spinner";

/** Stops a busy button from submitting its form or running its own click handlers. */
function blockActivation(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function isButtonBusy(button: HTMLButtonElement): boolean {
  return button.getAttribute("aria-busy") === "true";
}

export function setButtonBusy(button: HTMLButtonElement): void {
  if (isButtonBusy(button)) return;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-disabled", "true");
  const spinner = document.createElement("span");
  spinner.className = "pk-btn__spinner";
  spinner.setAttribute("aria-hidden", "true");
  spinner.setAttribute(SPINNER_MARKER, "");
  button.prepend(spinner);
  button.addEventListener("click", blockActivation, true);
}

export function clearButtonBusy(button: HTMLButtonElement): void {
  button.removeEventListener("click", blockActivation, true);
  button.querySelector(`:scope > [${SPINNER_MARKER}]`)?.remove();
  button.removeAttribute("aria-busy");
  button.removeAttribute("aria-disabled");
}
