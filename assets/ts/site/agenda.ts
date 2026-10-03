import { agendaLayoutCss } from "../../shared/agenda-layout-css";

// Stack the agenda toolbar below the actual section navigation, including
// responsive font and border sizes. Expanded dialogs keep their own top: 0.
const sectionNavigation = document.querySelector<HTMLElement>(".pk-section-navigation");
if (sectionNavigation && document.querySelector(".pk-content-agenda")) {
  const offsets = new CSSStyleSheet();
  const updateSectionOffset = () => {
    offsets.replaceSync(
      `:root { --pk-agenda-section-nav-height: ${sectionNavigation.getBoundingClientRect().height}px; }`,
    );
  };
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, offsets];
  updateSectionOffset();
  new ResizeObserver(updateSectionOffset).observe(sectionNavigation);
}

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

if (!document.querySelector("link[data-agenda-layout]")) {
  const css = agendaLayoutCss(
    [...document.querySelectorAll<HTMLElement>("[data-agenda-height]")].map((row) => Number(row.dataset.agendaHeight)),
  );
  if (css) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
}

document.querySelectorAll<HTMLElement>(".pk-content-agenda").forEach((root) => {
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
    panel.addEventListener("scroll", updateScrollControls, { passive: true });
  }
  new ResizeObserver(updateScrollControls).observe(root);
  for (const button of scrollButtons) {
    button.addEventListener("click", () => {
      const panel = activeTimeline();
      if (panel)
        panel.scrollBy({
          left: Number(button.dataset.agendaScroll) * panel.clientWidth * 0.8,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
    });
  }
  const compact = root.querySelector<HTMLButtonElement>("[data-agenda-compact]");
  compact?.addEventListener("click", () => {
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
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      position.replaceWith(root);
      expand.setAttribute("aria-expanded", "false");
      expand.setAttribute("aria-label", "Expand agenda");
      expand.setAttribute("title", "Expand agenda");
      if (enterIconPath) expandIcon?.setAttribute("d", enterIconPath);
      expand.focus();
    });
    expand.addEventListener("click", () => {
      if (dialog.open) {
        dialog.close();
        return;
      }
      root.before(position);
      dialog.append(root);
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
  updateScrollControls();
  root.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
    dialog.addEventListener("close", () => {
      dialog.querySelector<HTMLIFrameElement>("iframe")?.removeAttribute("src");
      if (!document.querySelector(".pk-content-agenda dialog[open]")) {
        document.body.classList.remove("agenda-modal-open");
      }
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  root.addEventListener("keydown", (event) => {
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
  root.addEventListener("click", (event) => {
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
    const card = target.closest<HTMLElement>("[data-agenda-session-dialog]");
    const cardClick =
      card &&
      !target.closest("a, button, input, select, textarea, label, summary, dialog") &&
      !window.getSelection()?.toString();
    const dialogId = opener?.dataset.agendaOpenSession ?? (cardClick ? card.dataset.agendaSessionDialog : undefined);
    if (dialogId) {
      const dialog = document.getElementById(dialogId);
      if (dialog instanceof HTMLDialogElement) {
        const iframe = dialog.querySelector<HTMLIFrameElement>("iframe[data-video-src]");
        if (iframe) iframe.src = iframe.dataset.videoSrc!;
        dialog.showModal();
        document.body.classList.add("agenda-modal-open");
      }
    }
    if (target.closest("[data-agenda-close-session]")) target.closest("dialog")?.close();
  });
});
