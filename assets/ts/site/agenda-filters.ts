import { filterAgendaLocationColumns, restoreAgendaLocationColumns } from "./agenda-location-columns";
import { formatNumber } from "../../shared/format-number";
import { applyPopupPosition, measurePopupPosition } from "../ui/popup-placement";

function locationInputs(group: HTMLElement | undefined): HTMLInputElement[] {
  return [...(group?.querySelectorAll<HTMLInputElement>("input[data-agenda-location]") ?? [])];
}

function filterLocationChoices(group: HTMLElement): void {
  const query =
    group.querySelector<HTMLInputElement>("[data-agenda-location-search]")?.value.trim().toLocaleLowerCase() ?? "";
  const rooms = locationInputs(group);
  for (const room of rooms) {
    const row = room.closest<HTMLElement>(".pk-agenda-locations__row");
    if (row) row.hidden = Boolean(query && !row.textContent?.toLocaleLowerCase().includes(query));
  }
  const empty = group.querySelector<HTMLElement>("[data-agenda-location-empty]");
  if (empty) empty.hidden = rooms.some((room) => !room.closest<HTMLElement>(".pk-agenda-locations__row")?.hidden);
}

// Narrowed with instanceof: the Worker typecheck's HTMLRewriter Element rejects HTMLSelectElement as a generic.
function filterValue(root: HTMLElement, selector: string): string {
  const control = root.querySelector<HTMLElement>(selector);
  return control instanceof HTMLSelectElement ? control.value : "";
}

/** Phones fold the filter row behind one toggle; CSS applies the folded state only at phone width. */
function setAgendaFiltersExpanded(root: HTMLElement, toggle: HTMLButtonElement, expanded: boolean): void {
  root.dataset.agendaFilters = expanded ? "expanded" : "collapsed";
  toggle.setAttribute("aria-expanded", String(expanded));
}

/** Location ownership is explicit because its toolbar sits outside the day panel. Returns the active filter count. */
export function refreshAgendaFilters(root: HTMLElement): number {
  const active = root.querySelector<HTMLElement>("[data-agenda-panel]:not([hidden])");
  const date = active?.dataset.agendaPanel;
  const query = root.querySelector<HTMLInputElement>("[data-agenda-search]")?.value.trim().toLocaleLowerCase() ?? "";
  const format = filterValue(root, "[data-agenda-format-filter]");
  const track = filterValue(root, "[data-agenda-track-filter]");
  // Portal personal agendas only: starred or registered cards carry data-agenda-mine.
  const mine = root.querySelector("[data-agenda-mine-filter]")?.getAttribute("aria-pressed") === "true";
  for (const group of root.querySelectorAll<HTMLElement>("[data-agenda-location-day]")) {
    group.hidden = group.dataset.agendaLocationDay !== date;
    filterLocationChoices(group);
    if (group.hidden) {
      const popup = group.querySelector<HTMLElement>("[popover]");
      if (popup?.dataset.agendaPopupOpen === "true") popup.hidePopover();
    }
  }
  const choices = [...root.querySelectorAll<HTMLElement>("[data-agenda-location-day]")].find(
    (group) => group.dataset.agendaLocationDay === date,
  );
  const rooms = locationInputs(choices);
  const selected = new Set(rooms.filter((room) => room.checked).map((room) => room.dataset.agendaLocation));
  const label = choices?.querySelector<HTMLElement>("[data-agenda-location-label]");
  if (label)
    label.textContent =
      selected.size === rooms.length
        ? "All locations"
        : `${formatNumber(selected.size)} of ${formatNumber(rooms.length)} locations`;
  for (const card of active?.querySelectorAll<HTMLElement>("[data-agenda-session]") ?? []) {
    const assigned = (card.dataset.agendaSession ?? "").split(" ").filter(Boolean);
    const matchesLocation =
      selected.size === rooms.length ||
      (assigned.length
        ? assigned.some((room) => selected.has(room))
        : card.dataset.agendaKind === "break"
          ? selected.size > 0
          : selected.has(rooms[0]?.dataset.agendaLocation));
    card.hidden = Boolean(
      !matchesLocation ||
      (query && !(card.dataset.agendaSearchText ?? "").toLocaleLowerCase().includes(query)) ||
      // Like the former type filter, a chosen format also hides breaks, which carry no format.
      (format && card.dataset.agendaFormat !== format) ||
      (track && card.dataset.agendaTrack !== track) ||
      (mine && !card.hasAttribute("data-agenda-mine")),
    );
  }
  if (active) filterAgendaLocationColumns(active, selected);
  const clear = root.querySelector<HTMLButtonElement>("[data-agenda-clear-filters]");
  if (clear) clear.hidden = !query && !format && !track && !mine && selected.size === rooms.length;
  // My agenda is its own toolbar control, so only the folded row's filters count here.
  const activeFilters = [query, format, track, selected.size !== rooms.length].filter(Boolean).length;
  const count = root.querySelector<HTMLElement>("[data-agenda-filters-count]");
  if (count) {
    count.textContent = activeFilters ? formatNumber(activeFilters) : "";
    count.hidden = !activeFilters;
  }
  return activeFilters;
}

export function initializeAgendaFilters(root: HTMLElement): () => void {
  const events = new AbortController();
  let printedCards: Map<HTMLElement, boolean> | undefined;
  const restoreScreen = () => {
    if (!printedCards) return;
    for (const [card, hidden] of printedCards) card.hidden = hidden;
    printedCards = undefined;
    // Reapply each day's location choices, including inactive printed panels.
    for (const panel of root.querySelectorAll<HTMLElement>("[data-agenda-panel]")) {
      const group = [...root.querySelectorAll<HTMLElement>("[data-agenda-location-day]")].find(
        (item) => item.dataset.agendaLocationDay === panel.dataset.agendaPanel,
      );
      const selected = new Set(
        locationInputs(group)
          .filter((room) => room.checked)
          .map((room) => room.dataset.agendaLocation),
      );
      filterAgendaLocationColumns(panel, selected);
    }
    refreshAgendaFilters(root);
  };
  window.addEventListener(
    "beforeprint",
    () => {
      if (!root.querySelector("[data-agenda-print]") || printedCards) return;
      printedCards = new Map(
        [...root.querySelectorAll<HTMLElement>("[data-agenda-session]")].map((card) => [card, card.hidden]),
      );
      for (const card of printedCards.keys()) card.hidden = false;
      restoreAgendaLocationColumns(root);
    },
    { signal: events.signal },
  );
  window.addEventListener("afterprint", restoreScreen, { signal: events.signal });
  const views = [...root.querySelectorAll<HTMLButtonElement>("[data-agenda-view]")];
  if (views.length) {
    root.dataset.agendaView ??= window.matchMedia("(max-width: 47.499rem)").matches ? "list" : "grid";
    for (const button of views)
      button.setAttribute("aria-pressed", String(button.dataset.agendaView === root.dataset.agendaView));
  }
  const filtersToggle = root.querySelector<HTMLButtonElement>("[data-agenda-filters-toggle]");
  const placePopups = () => {
    for (const popup of root.querySelectorAll<HTMLElement>("[data-agenda-popup-open='true']")) {
      const trigger = popup.parentElement?.querySelector<HTMLButtonElement>("[data-agenda-location-trigger]");
      if (trigger)
        applyPopupPosition(popup, measurePopupPosition(trigger.getBoundingClientRect(), popup.getBoundingClientRect()));
    }
  };
  root.addEventListener(
    "toggle",
    (event) => {
      const popup = event.target;
      if (!(popup instanceof HTMLElement) || !popup.classList.contains("pk-content-agenda__location-popup")) return;
      const open = popup.matches(":popover-open");
      popup.dataset.agendaPopupOpen = String(open);
      popup.parentElement?.querySelector("[data-agenda-location-trigger]")?.setAttribute("aria-expanded", String(open));
      if (open) placePopups();
    },
    { capture: true, signal: events.signal },
  );
  root.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLButtonElement>("[data-agenda-locations-action]");
      if (action) {
        const group = action.closest<HTMLElement>("[data-agenda-location-day]");
        for (const room of locationInputs(group ?? undefined))
          room.checked = action.dataset.agendaLocationsAction === "all";
        refreshAgendaFilters(root);
      }
      if (event.target.closest("[data-agenda-clear-filters]")) {
        for (const input of root.querySelectorAll<HTMLElement>(
          "[data-agenda-search], [data-agenda-format-filter], [data-agenda-track-filter], [data-agenda-location-search]",
        ))
          if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = "";
        for (const room of locationInputs(root)) room.checked = true;
        root.querySelector("[data-agenda-mine-filter]")?.setAttribute("aria-pressed", "false");
        refreshAgendaFilters(root);
      }
      const mine = event.target.closest<HTMLButtonElement>("[data-agenda-mine-filter]");
      if (mine) {
        mine.setAttribute("aria-pressed", String(mine.getAttribute("aria-pressed") !== "true"));
        refreshAgendaFilters(root);
      }
      if (filtersToggle && event.target.closest("[data-agenda-filters-toggle]"))
        setAgendaFiltersExpanded(root, filtersToggle, root.dataset.agendaFilters === "collapsed");
      if (event.target.closest("[data-agenda-print]")) window.print();
      const view = event.target.closest<HTMLButtonElement>("[data-agenda-view]");
      if (view) {
        root.dataset.agendaView = view.dataset.agendaView;
        for (const button of root.querySelectorAll<HTMLButtonElement>("[data-agenda-view]"))
          button.setAttribute("aria-pressed", String(button === view));
      }
    },
    { signal: events.signal },
  );
  const update = () => refreshAgendaFilters(root);
  root.addEventListener("input", update, { signal: events.signal });
  root.addEventListener("change", update, { signal: events.signal });
  window.addEventListener("resize", placePopups, { signal: events.signal });
  window.addEventListener("scroll", placePopups, { capture: true, signal: events.signal });
  const activeFilters = refreshAgendaFilters(root);
  // Restored form values keep their filters in view; otherwise the program comes first.
  if (filtersToggle) setAgendaFiltersExpanded(root, filtersToggle, activeFilters > 0);
  return () => {
    restoreScreen();
    events.abort();
    delete root.dataset.agendaFilters;
  };
}
