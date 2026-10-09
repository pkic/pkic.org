import { applyPopupPosition, measurePopupPosition } from "../ui/popup-placement";

/** One delegated interaction owner for static pages and hydrated agenda content. */
export function initializeAgendaSpeakers(root: HTMLElement): () => void {
  const events = new AbortController();
  const openers = new WeakMap<HTMLDialogElement, HTMLButtonElement>();
  let preview: HTMLElement | undefined;
  const hide = () => {
    if (preview?.dataset.agendaPreviewOpen === "true") {
      preview.hidePopover();
      delete preview.dataset.agendaPreviewOpen;
    }
    preview = undefined;
  };
  const show = (target: EventTarget | null) => {
    const button = target instanceof Element ? target.closest<HTMLButtonElement>("[data-agenda-open-speaker]") : null;
    const popup = button?.closest("[data-agenda-speaker]")?.querySelector<HTMLElement>("[data-agenda-speaker-preview]");
    if (!button || !popup || typeof popup.showPopover !== "function") return;
    if (preview === popup) return;
    hide();
    popup.showPopover();
    popup.dataset.agendaPreviewOpen = "true";
    // A compact profile preview keeps its own width, even when its trigger spans a wide card.
    popup.style.setProperty("min-width", "0px");
    applyPopupPosition(popup, {
      ...measurePopupPosition(button.getBoundingClientRect(), popup.getBoundingClientRect()),
      minWidth: 0,
    });
    preview = popup;
  };
  root.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType !== "touch") show(event.target);
    },
    { signal: events.signal },
  );
  root.addEventListener(
    "pointerout",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("[data-agenda-open-speaker]");
      if (button && (!(event.relatedTarget instanceof Node) || !button.contains(event.relatedTarget))) hide();
    },
    { signal: events.signal },
  );
  root.addEventListener("focusin", (event) => show(event.target), { signal: events.signal });
  root.addEventListener("focusout", hide, { signal: events.signal });
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") hide();
    },
    { signal: events.signal },
  );
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
      const dialog = button
        ?.closest("[data-agenda-speaker]")
        ?.querySelector<HTMLDialogElement>("dialog[data-agenda-speaker-dialog]");
      if (!button || !dialog || dialog.id !== button.getAttribute("aria-controls")) return;
      event.stopPropagation();
      hide();
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
  window.addEventListener("scroll", hide, { capture: true, passive: true, signal: events.signal });
  window.addEventListener("resize", hide, { passive: true, signal: events.signal });
  return () => {
    hide();
    events.abort();
  };
}
