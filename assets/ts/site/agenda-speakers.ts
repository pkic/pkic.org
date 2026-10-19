import { attachPersonPreview } from "./static-person-preview";

/**
 * The element an opener names by id: an agenda renders each speaker's preview and profile once,
 * beside the program, so they are found by reference rather than next to the opener.
 */
function referenced<T extends Element>(
  root: HTMLElement,
  button: Element,
  attribute: string,
  selector: string,
): T | null {
  const id = button.getAttribute(attribute)?.split(/\s+/)[0];
  if (!id) return null;
  return [...root.querySelectorAll<T>(selector)].find((element) => element.id === id) ?? null;
}

/** One delegated interaction owner for static pages and hydrated agenda content. */
export function initializeAgendaSpeakers(root: HTMLElement): () => void {
  const events = new AbortController();
  const openers = new WeakMap<HTMLDialogElement, HTMLButtonElement>();
  const previews: (() => void)[] = [];
  const profiles = new Map(
    [...root.querySelectorAll<HTMLElement>("[data-person-card-profile]")].map((entry) => [
      entry.dataset.personCardProfile,
      entry.dataset.personCard ? JSON.parse(entry.dataset.personCard) : null,
    ]),
  );
  for (const button of root.querySelectorAll<HTMLElement>("[data-agenda-open-speaker]")) {
    const person = profiles.get(button.getAttribute("aria-controls") ?? "");
    if (person) previews.push(attachPersonPreview(button, person));
  }
  root.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const close = event.target.closest("[data-agenda-close-speaker]");
      if (close) {
        close.closest<HTMLDialogElement>("dialog[data-agenda-speaker-dialog]")?.close();
        return;
      }
      const button = event.target.closest<HTMLButtonElement>("[data-agenda-open-speaker]");
      const dialog =
        button && referenced<HTMLDialogElement>(root, button, "aria-controls", "dialog[data-agenda-speaker-dialog]");
      if (!button || !dialog) return;
      event.stopPropagation();
      if (!dialog.open) {
        openers.set(dialog, button);
        dialog.showModal();
      }
    },
    { signal: events.signal },
  );
  root.addEventListener(
    "close",
    (event) => {
      if (event.target instanceof HTMLDialogElement && event.target.hasAttribute("data-agenda-speaker-dialog")) {
        const opener = openers.get(event.target);
        if (opener?.isConnected) opener.focus();
      }
    },
    { capture: true, signal: events.signal },
  );
  return () => {
    for (const stop of previews) stop();
    events.abort();
  };
}
