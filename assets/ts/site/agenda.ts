import { observeAgendaLayout } from "./agenda-layout-stylesheet";
import { initializeAgendaSessionMedia, pauseAgendaSessionMedia } from "./agenda-session-media";

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
}

function selectLocation(root: HTMLElement, selected: HTMLButtonElement): void {
  const location = selected.dataset.agendaLocation;
  if (!location) return;
  const panel = selected.closest<HTMLElement>("[data-agenda-panel]");
  if (!panel || !root.contains(panel)) return;
  const rooms = [
    ...panel.querySelectorAll<HTMLButtonElement>("[data-agenda-location]:not([data-agenda-location='all'])"),
  ];
  rooms.forEach((button) => {
    const active =
      location === "all"
        ? selected.getAttribute("aria-pressed") !== "true"
        : button === selected
          ? button.getAttribute("aria-pressed") !== "true"
          : button.getAttribute("aria-pressed") === "true";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const selectedRooms = new Set(
    rooms
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset.agendaLocation),
  );
  const all = panel.querySelector<HTMLButtonElement>("[data-agenda-location='all']");
  const allSelected = selectedRooms.size === rooms.length;
  all?.classList.toggle("is-active", allSelected);
  all?.setAttribute("aria-pressed", String(allSelected));
  panel.querySelectorAll<HTMLElement>("[data-agenda-session]").forEach((session) => {
    session.hidden =
      !allSelected && !(session.dataset.agendaSession ?? "").split(" ").some((room) => selectedRooms.has(room));
  });
}

const initializedAgendas = new WeakMap<HTMLElement, () => void>();
export function initializeContentAgenda(root: HTMLElement): () => void {
  const existing = initializedAgendas.get(root);
  if (existing) return existing;
  const cleanup: (() => void)[] = [];
  cleanup.push(observeAgendaLayout(root));
  cleanup.push(initializeAgendaSessionMedia(root));
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
      const inDialog = Boolean(root.closest("dialog[open]"));
      const navbarHeight =
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pkic-navbar-height")) || 57;
      const sectionNav = root.closest("#portal-root")
        ? null
        : document.querySelector<HTMLElement>(".pk-section-navigation");
      const sectionHeight =
        sectionNav && getComputedStyle(sectionNav).position === "sticky"
          ? sectionNav.getBoundingClientRect().height
          : 0;
      const portalTopbar = root.closest("#portal-root")?.querySelector<HTMLElement>("#portal-topbar");
      const portalTopbarBottom =
        portalTopbar &&
        getComputedStyle(portalTopbar).display !== "none" &&
        ["sticky", "fixed"].includes(getComputedStyle(portalTopbar).position)
          ? portalTopbar.getBoundingClientRect().bottom
          : 0;
      const top = inDialog ? 0 : Math.max(navbarHeight + sectionHeight, portalTopbarBottom);
      const toolbar = root.querySelector<HTMLElement>("[data-agenda-controls]");
      const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 0;
      const rules = [`[data-agenda-sticky-id="${stickyId}"] { --pk-agenda-sticky-top: ${top}px; }`];
      if (toolbar) {
        const naturalTop = toolbar.getBoundingClientRect().top - toolbarOffset;
        toolbarOffset = Math.max(
          0,
          Math.min(top - naturalTop, root.getBoundingClientRect().bottom - toolbarHeight - naturalTop),
        );
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
      compact.setAttribute("aria-pressed", String(root.classList.toggle("is-compact")));
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
      expand.setAttribute("aria-expanded", "true");
      expand.setAttribute("aria-label", "Exit fullscreen");
      expand.setAttribute("title", "Exit fullscreen");
      expandIcon?.setAttribute("d", "M6 2v4H2m12 0h-4V2M2 10h4v4m4 0v-4h4");
      dialog.showModal();
      expand.focus();
    });
  }
  const firstTab = root.querySelector<HTMLButtonElement>("[data-agenda-tab]");
  if (firstTab) selectTab(root, firstTab);
  const uniqueElementById = (id: string): HTMLElement | null => {
    const matches = [...root.querySelectorAll<HTMLElement>("[id]")].filter((element) => element.id === id);
    return matches.length === 1 ? matches[0]! : null;
  };
  function openSessionDialog(id: string): void {
    const dialog = uniqueElementById(id);
    if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
    const iframe = dialog.querySelector<HTMLIFrameElement>("iframe[data-video-src]");
    if (iframe && !iframe.closest("[hidden]")) iframe.src = iframe.dataset.videoSrc!;
    dialog.showModal();
    document.body.classList.add("agenda-modal-open");
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
    else (target.hidden ? tabs[0] : target)?.scrollIntoView?.({ block: "start" });
  }
  // Portal agendas share rendering, but their global hash belongs to the router.
  if (root.hasAttribute("data-agenda-public-fragments")) {
    window.addEventListener("hashchange", resolvePublicFragment, { signal: events.signal });
    resolvePublicFragment();
  }
  updateScrollControls();
  root.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
    listen(dialog, "close", () => {
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
    const location = target.closest<HTMLButtonElement>("[data-agenda-location]");
    if (location) selectLocation(root, location);
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
