import { initializeAgendaSpeakers } from "./agenda-speakers";
import { initializeAgendaFilters, refreshAgendaFilters } from "./agenda-filters";
import { observeAgendaLayout } from "./agenda-layout-stylesheet";
import { initializeAgendaSessionMedia, pauseAgendaSessionMedia } from "./agenda-session-media";
import { initializeAgendaNowLine } from "./agenda-now-line";
import { agendaStickyTop } from "./agenda-sticky-top";
import { agendaTodayTab, initializeAgendaEarlierSessions, revealAgendaEarlierSessions } from "./agenda-today-focus";
import { observeDeferredImages, revealDeferredImages } from "./deferred-images";

let agendaStickySequence = 0;

function selectTab(root: HTMLElement, selected: HTMLButtonElement): void {
  const target = selected.dataset.agendaTab;
  if (!target) return;
  root.querySelectorAll<HTMLButtonElement>("[data-agenda-tab]").forEach((button) => {
    const active = button === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll<HTMLElement>("[data-agenda-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.agendaPanel !== target;
  });
  refreshAgendaFilters(root);
}

function showAgendaSessionDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  // A modal inside a collapsed earlier slot would have no box to render.
  revealAgendaEarlierSessions(dialog);
  const iframe = dialog.querySelector<HTMLIFrameElement>("iframe[data-video-src]");
  if (iframe && !iframe.closest("[hidden]")) iframe.src = iframe.dataset.videoSrc!;
  dialog.showModal();
  document.body.classList.add("agenda-modal-open");
}

/** Portal deep links open one occurrence's details after showing the day that contains it. */
export function openContentAgendaOccurrence(root: HTMLElement, occurrenceId: string): boolean {
  const card = [...root.querySelectorAll<HTMLElement>("[data-agenda-session-dialog]")].find(
    (element) => element.dataset.agendaOccurrence === occurrenceId,
  );
  const dialog = [...root.querySelectorAll<HTMLDialogElement>("dialog")].find(
    (element) => card && element.id === card.dataset.agendaSessionDialog,
  );
  if (!card || !dialog) return false;
  const day = card.closest<HTMLElement>("[data-agenda-panel]")?.dataset.agendaPanel;
  const tab = [...root.querySelectorAll<HTMLButtonElement>("[data-agenda-tab]")].find(
    (button) => button.dataset.agendaTab === day,
  );
  if (tab) selectTab(root, tab);
  // A newly linked session replaces the open one rather than stacking over it.
  root.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((open) => {
    if (open !== dialog) open.close();
  });
  showAgendaSessionDialog(dialog);
  return true;
}

const initializedAgendas = new WeakMap<HTMLElement, () => void>();
export function initializeContentAgenda(root: HTMLElement): () => void {
  const existing = initializedAgendas.get(root);
  if (existing) return existing;
  const cleanup: (() => void)[] = [];
  cleanup.push(observeAgendaLayout(root));
  cleanup.push(initializeAgendaSessionMedia(root));
  cleanup.push(initializeAgendaFilters(root));
  cleanup.push(initializeAgendaSpeakers(root));
  cleanup.push(initializeAgendaNowLine(root));
  cleanup.push(observeDeferredImages(root));
  const events = new AbortController();
  cleanup.push(() => events.abort());
  const stickySheet =
    typeof CSSStyleSheet === "function" && Array.isArray(document.adoptedStyleSheets) ? new CSSStyleSheet() : undefined;
  if (stickySheet && typeof stickySheet.replaceSync === "function") {
    const stickyId = String(++agendaStickySequence);
    root.dataset.agendaStickyId = stickyId;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, stickySheet];
    let stickyFrame = 0;
    let toolbarOffset = 0;
    const cardOffsets = new WeakMap<HTMLElement, number>();
    let cardSequence = 0;
    const updateStickyHeader = () => {
      stickyFrame = 0;
      const top = agendaStickyTop(root);
      const toolbar = root.querySelector<HTMLElement>("[data-agenda-controls]");
      // On phones the filters would cover a large part of the screen, so they scroll away with the page and the
      // table header sticks directly below the page header instead of below the toolbar.
      const toolbarScrollsAway = window.matchMedia("(max-width: 47.499rem)").matches;
      const toolbarHeight = toolbar && !toolbarScrollsAway ? toolbar.getBoundingClientRect().height : 0;
      const rules = [`[data-agenda-sticky-id="${stickyId}"] { --pk-agenda-sticky-top: ${top}px; }`];
      if (toolbar) {
        const naturalTop = toolbar.getBoundingClientRect().top - toolbarOffset;
        toolbarOffset = toolbarScrollsAway
          ? 0
          : Math.max(0, Math.min(top - naturalTop, root.getBoundingClientRect().bottom - toolbarHeight - naturalTop));
        rules.push(
          `[data-agenda-sticky-id="${stickyId}"] .pk-content-agenda__controls:not([hidden]) { position: relative; top: ${toolbarOffset}px; z-index: 10; }`,
        );
      }
      for (const panel of root.querySelectorAll<HTMLElement>(".pk-content-agenda__day")) {
        const table = panel.querySelector<HTMLTableElement>(".pk-content-agenda__timeline");
        const header = table?.tHead;
        if (!table || !header || panel.hidden || getComputedStyle(header).display === "none") continue;
        const tableRect = table.getBoundingClientRect();
        const offset = Math.max(
          0,
          Math.min(top + toolbarHeight - tableRect.top, tableRect.height - header.getBoundingClientRect().height),
        );
        rules.push(
          `[data-agenda-sticky-id="${stickyId}"] [data-agenda-panel="${panel.dataset.agendaPanel}"] thead { position: relative; top: ${offset}px; z-index: 8; }`,
        );
        const headerBottom = tableRect.top + offset + header.getBoundingClientRect().height;
        for (const controls of panel.querySelectorAll<HTMLElement>(".pk-agenda-editor__card-actions")) {
          const card = controls.closest<HTMLElement>(".pk-content-agenda__session");
          if (!card) continue;
          const naturalTop = controls.getBoundingClientRect().top - (cardOffsets.get(controls) ?? 0);
          const footer = card.querySelector<HTMLElement>(".pk-content-agenda__move-controls");
          const end = footer?.getBoundingClientRect().top ?? card.getBoundingClientRect().bottom;
          const menuOffset = Math.max(
            0,
            Math.min(headerBottom + 4 - naturalTop, end - controls.getBoundingClientRect().height - 4 - naturalTop),
          );
          cardOffsets.set(controls, menuOffset);
          controls.dataset.agendaStickyControl ??= String(++cardSequence);
          rules.push(
            `[data-agenda-sticky-id="${stickyId}"] [data-agenda-sticky-control="${controls.dataset.agendaStickyControl}"] { position: relative; top: ${menuOffset}px; }`,
          );
        }
      }
      stickySheet.replaceSync(rules.join("\n"));
    };
    const queueStickyHeader = () => {
      if (!stickyFrame) stickyFrame = requestAnimationFrame(updateStickyHeader);
    };
    window.addEventListener("scroll", queueStickyHeader, { passive: true, capture: true, signal: events.signal });
    window.addEventListener("resize", queueStickyHeader, { passive: true, signal: events.signal });
    const stickyObserver = new ResizeObserver(queueStickyHeader);
    stickyObserver.observe(root);
    const toolbar = root.querySelector<HTMLElement>("[data-agenda-controls]");
    if (toolbar) stickyObserver.observe(toolbar);
    const portalTopbar = root.closest("#portal-root")?.querySelector<HTMLElement>("#portal-topbar");
    if (portalTopbar) stickyObserver.observe(portalTopbar);
    cleanup.push(() => {
      cancelAnimationFrame(stickyFrame);
      stickyObserver.disconnect();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== stickySheet);
      delete root.dataset.agendaStickyId;
    });
    queueStickyHeader();
  }

  const listen = <K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => element.addEventListener(type, listener, { ...options, signal: events.signal });
  root.querySelector<HTMLElement>("[data-agenda-controls]")?.removeAttribute("hidden");
  const scrollButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-agenda-scroll]")];
  const activeTimeline = () => root.querySelector<HTMLElement>(".pk-content-agenda__day:not([hidden])");
  const updateScrollControls = () => {
    const panel = activeTimeline();
    const maximum = panel ? panel.scrollWidth - panel.clientWidth : 0;
    if (panel) {
      // Edge fades show that more rooms are available in either direction.
      const before = panel.scrollLeft > 2;
      const after = panel.scrollLeft < maximum - 2;
      panel.dataset.agendaMore = before && after ? "both" : before ? "before" : after ? "after" : "none";
    }
    for (const button of scrollButtons) {
      button.hidden = maximum < 2;
      button.disabled =
        Number(button.dataset.agendaScroll) < 0
          ? (panel?.scrollLeft ?? 0) < 2
          : (panel?.scrollLeft ?? 0) >= maximum - 2;
    }
  };
  for (const panel of root.querySelectorAll<HTMLElement>(".pk-content-agenda__day")) {
    listen(panel, "scroll", updateScrollControls, { passive: true });
  }
  const observer = new ResizeObserver(updateScrollControls);
  observer.observe(root);
  cleanup.push(() => observer.disconnect());
  for (const button of scrollButtons) {
    listen(button, "click", () => {
      const panel = activeTimeline();
      if (panel)
        panel.scrollBy({
          left: Number(button.dataset.agendaScroll) * panel.clientWidth * 0.8,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
    });
  }
  const compact = root.querySelector<HTMLButtonElement>("[data-agenda-compact]");
  if (compact)
    listen(compact, "click", () => {
      const collapsed = root.classList.toggle("is-compact");
      compact.setAttribute("aria-pressed", String(!collapsed));
      const label = collapsed ? "Show session descriptions" : "Hide session descriptions";
      compact.setAttribute("aria-label", label);
      compact.setAttribute("title", label);
      compact
        .querySelector("svg path")
        ?.setAttribute("d", collapsed ? "m4 6 4-4 4 4M4 10l4 4 4-4" : "m4 2 4 4 4-4M4 14l4-4 4 4");
    });
  const expand = root.querySelector<HTMLButtonElement>("[data-agenda-expand]");
  if (expand) {
    const expandIcon = expand.querySelector("svg path");
    const enterIconPath = expandIcon?.getAttribute("d");
    const dialog = document.createElement("dialog");
    dialog.className = "pk-agenda-dialog";
    dialog.setAttribute("aria-label", "Expanded event agenda");
    const position = document.createComment("Agenda position");
    document.body.appendChild(dialog);
    cleanup.push(() => {
      if (dialog.open) dialog.close();
      dialog.remove();
      position.remove();
    });
    listen(dialog, "close", () => {
      position.replaceWith(root);
      expand.setAttribute("aria-expanded", "false");
      expand.setAttribute("aria-pressed", "false");
      expand.setAttribute("aria-label", "Expand agenda");
      expand.setAttribute("title", "Expand agenda");
      if (enterIconPath) expandIcon?.setAttribute("d", enterIconPath);
      expand.focus();
    });
    listen(expand, "click", () => {
      if (dialog.open) {
        dialog.close();
        return;
      }
      root.parentNode?.insertBefore(position, root);
      dialog.appendChild(root);
      dialog.showModal();
      expand.setAttribute("aria-expanded", String(dialog.open));
      expand.setAttribute("aria-pressed", String(dialog.open));
      expand.setAttribute("aria-label", "Exit fullscreen");
      expand.setAttribute("title", "Exit fullscreen");
      expandIcon?.setAttribute("d", "M6 2v4H2m12 0h-4V2M2 10h4v4m4 0v-4h4");
      expand.focus();
    });
  }
  // A deep link chooses its own day; otherwise an event day opens on today in the event's zone.
  const focusToday =
    root.hasAttribute("data-agenda-today-focus") &&
    !(root.hasAttribute("data-agenda-public-fragments") && window.location.hash.length > 1);
  const initialTab =
    (focusToday ? agendaTodayTab(root) : undefined) ?? root.querySelector<HTMLButtonElement>("[data-agenda-tab]");
  if (initialTab) selectTab(root, initialTab);
  // A panel that was never hidden records no change: show what the opening tab already shows.
  revealDeferredImages(root);
  if (focusToday) cleanup.push(initializeAgendaEarlierSessions(root));
  const uniqueElementById = (id: string): HTMLElement | null => {
    const matches = [...root.querySelectorAll<HTMLElement>("[id]")].filter((element) => element.id === id);
    return matches.length === 1 ? matches[0]! : null;
  };
  function openSessionDialog(id: string): void {
    const dialog = uniqueElementById(id);
    if (dialog instanceof HTMLDialogElement) showAgendaSessionDialog(dialog);
  }
  function resolvePublicFragment(): void {
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!id) return;
    const target = uniqueElementById(id);
    if (!target) return;
    const panel =
      target.dataset.agendaFragmentPanel ?? target.closest<HTMLElement>("[data-agenda-panel]")?.dataset.agendaPanel;
    const tabTarget = target.closest<HTMLElement>("[data-agenda-tab]")?.dataset.agendaTab ?? panel;
    const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-agenda-tab]")].filter(
      (tab) => tab.dataset.agendaTab === tabTarget,
    );
    if (tabs.length !== 1) return;
    const dialog = target.closest<HTMLDialogElement>("dialog");
    const dialogId = target.dataset.agendaFragmentDialog ?? dialog?.id;
    if (dialogId && !(uniqueElementById(dialogId) instanceof HTMLDialogElement)) return;
    root.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((open) => {
      if (open.id !== dialogId) open.close();
    });
    selectTab(root, tabs[0]!);
    updateScrollControls();
    if (dialogId) openSessionDialog(dialogId);
    else {
      revealAgendaEarlierSessions(target);
      (target.hidden ? tabs[0] : target)?.scrollIntoView?.({ block: "start" });
    }
  }
  // Portal agendas share rendering, but their global hash belongs to the router.
  if (root.hasAttribute("data-agenda-public-fragments")) {
    window.addEventListener("hashchange", resolvePublicFragment, { signal: events.signal });
    resolvePublicFragment();
  }
  updateScrollControls();
  root.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
    listen(dialog, "close", (event) => {
      if (event.target !== dialog) return;
      pauseAgendaSessionMedia(dialog);
      if (!document.querySelector(".pk-content-agenda dialog[open]")) {
        document.body.classList.remove("agenda-modal-open");
      }
    });
    listen(dialog, "click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  listen(root, "keydown", (event) => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.matches("[data-agenda-tab]")) return;
    const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-agenda-tab]")];
    const index = tabs.indexOf(event.target);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : event.key === "ArrowLeft"
              ? (index + tabs.length - 1) % tabs.length
              : null;
    if (next === null) return;
    event.preventDefault();
    selectTab(root, tabs[next]!);
    updateScrollControls();
    tabs[next]!.focus();
  });
  listen(root, "click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tab = target.closest<HTMLButtonElement>("[data-agenda-tab]");
    if (tab) {
      selectTab(root, tab);
      updateScrollControls();
    }
    const opener = target.closest<HTMLElement>("[data-agenda-open-session]");
    if (opener instanceof HTMLAnchorElement) {
      const dialogId = opener.dataset.agendaOpenSession;
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        opener.hasAttribute("download") ||
        (opener.target && opener.target !== "_self") ||
        !dialogId ||
        !(uniqueElementById(dialogId) instanceof HTMLDialogElement)
      )
        return;
      event.preventDefault();
    }
    if (opener?.hasAttribute("data-agenda-watch-recording")) event.preventDefault();
    const card = target.closest<HTMLElement>("[data-agenda-session-dialog]");
    const cardClick =
      card &&
      !target.closest("a, button, input, select, textarea, label, summary, dialog, [data-agenda-card-control]") &&
      !window.getSelection()?.toString();
    const dialogId = opener?.dataset.agendaOpenSession ?? (cardClick ? card.dataset.agendaSessionDialog : undefined);
    if (dialogId) {
      openSessionDialog(dialogId);
    }
    if (target.closest("[data-agenda-close-session]")) target.closest("dialog")?.close();
  });
  const dispose = () => {
    root.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((dialog) => dialog.close());
    [...cleanup].reverse().forEach((callback) => callback());
    initializedAgendas.delete(root);
  };
  initializedAgendas.set(root, dispose);
  return dispose;
}

document.querySelectorAll<HTMLElement>(".pk-content-agenda").forEach(initializeContentAgenda);
