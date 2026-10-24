import { agendaStickyTop } from "./agenda-sticky-top";
import { splitHash, subscribeUrlQuery, writeUrlQuery } from "../ui/url-query";
import { refreshAgendaFilters } from "./agenda-filters";

const sessionKey = (card: HTMLElement) => card.dataset.agendaOccurrence ?? card.dataset.agendaSessionDialog;
const fragmentFields = ["session", "agendaSpeaker", "agendaPosition", "agendaRoom"] as const;

const fields = {
  agendaSearch: "[data-agenda-search]",
  agendaType: "[data-agenda-format-filter]",
  agendaTrack: "[data-agenda-track-filter]",
  agendaZone: "[data-agenda-time-select]",
} as const;

/** Public dialog and scroll state stays in the fragment; filters retain the route's query. */
export function initializeAgendaUrlState(
  root: HTMLElement,
  selectTab: (button: HTMLButtonElement) => void,
  openOccurrence: (id: string) => boolean,
  openSessionDialog?: (id: string) => void,
): () => void {
  const portal = location.hash.startsWith("#/");
  const currentPath = () => (portal ? splitHash().path : location.pathname);
  const agendaRoute = (path: string) => path.match(/^(.*\/agenda)(?:\/(speakers|\d{4}-\d{2}-\d{2}))?\/?$/);
  const route = currentPath();
  const publicBase = root.dataset.agendaBasePath?.replace(/\/$/, "");
  const naturalPaths = (portal && Boolean(agendaRoute(route))) || Boolean(publicBase);
  const basePath = portal ? (agendaRoute(route)?.[1] ?? route) : (publicBase ?? route);
  const events = new AbortController();
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-agenda-tab]")];
  const controls = Object.entries(fields).map(([key, selector]) => {
    const element = root.querySelector<HTMLElement>(selector);
    return { key, input: element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element : null };
  });
  const defaults = new Map(controls.map(({ key, input }) => [key, input?.value ?? ""]));
  const defaultDay = tabs.find((button) => button.getAttribute("aria-selected") === "true")?.dataset.agendaTab;
  const defaultView = root.dataset.agendaView;
  const defaultCompact = root.classList.contains("is-compact");
  let restoring = false,
    disposed = false;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let restoreFrame = 0;
  let writing = false;
  const commits = new Set<ReturnType<typeof setTimeout>>();
  const sameRoute = () =>
    naturalPaths
      ? currentPath() === route || (agendaRoute(currentPath())?.[1] ?? currentPath().replace(/\/$/, "")) === basePath
      : currentPath() === route;
  const params = () => {
    if (portal) return splitHash().params;
    const query = new URL(location.href).searchParams;
    const fragment = splitHash().params;
    for (const key of fragmentFields) {
      query.delete(key);
      const value = fragment.get(key);
      if (value !== null) query.set(key, value);
    }
    return query;
  };
  function write(changes: Record<string, string | null>, push = false) {
    if (restoring || disposed || !sameRoute()) return;
    const next = params();
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    let destinationPath = currentPath();
    const day = changes.agendaDay ?? (naturalPaths ? agendaRoute(destinationPath)?.[2] : null);
    if (naturalPaths && day && (day === "speakers" || /^\d{4}-\d{2}-\d{2}$/.test(day))) {
      destinationPath = `${basePath}/${day}${portal ? "" : "/"}`;
      next.delete("agendaDay");
    }
    writing = true;
    try {
      const fragmentParams = portal ? undefined : splitHash().params;
      if (fragmentParams)
        for (const key of fragmentFields) {
          const value = next.get(key);
          if (value === null) fragmentParams.delete(key);
          else fragmentParams.set(key, value);
          next.delete(key);
        }
      writeUrlQuery({
        source: portal ? "hash" : "search",
        ownerPath: currentPath(),
        destinationPath,
        params: next,
        fragmentParams,
        mode: push ? "push" : "replace",
      });
    } finally {
      writing = false;
    }
  }
  function snapshot(push: boolean) {
    const changes: Record<string, string | null> = {
      agendaZone: params().get("agendaZone") === "venue" ? null : params().get("agendaZone"),
    };
    for (const { key, input } of controls)
      if (input) changes[key] = key === "agendaZone" && input.value === "venue" ? null : input.value;
    changes.agendaDay =
      tabs.find((button) => button.getAttribute("aria-selected") === "true")?.dataset.agendaTab ?? null;
    changes.agendaView = root.dataset.agendaView === defaultView ? null : (root.dataset.agendaView ?? null);
    changes.agendaMine =
      root.querySelector("[data-agenda-mine-filter]")?.getAttribute("aria-pressed") === "true" ? "1" : null;
    if (
      ((naturalPaths ? agendaRoute(currentPath())?.[2] : null) ?? params().get("agendaDay") ?? defaultDay) !==
      changes.agendaDay
    ) {
      changes.agendaPosition = null;
      changes.agendaRoom = null;
    }
    changes.agendaAbstract = root.classList.contains("is-compact") ? "hidden" : null;
    const rooms: Record<string, string[]> = {};
    for (const day of root.querySelectorAll<HTMLElement>("[data-agenda-location-day]")) {
      const inputs = [...day.querySelectorAll<HTMLInputElement>("[data-agenda-location]")];
      if (inputs.some((input) => !input.checked))
        rooms[day.dataset.agendaLocationDay!] = inputs
          .filter((input) => input.checked)
          .map((input) => input.dataset.agendaLocation!);
    }
    changes.agendaRooms = Object.keys(rooms).length ? JSON.stringify(rooms) : null;
    const speaker = root.querySelector<HTMLDialogElement>("dialog[data-agenda-speaker-key][open]");
    changes.agendaSpeaker = speaker?.dataset.agendaSpeakerKey ?? null;
    const session = [...root.querySelectorAll<HTMLElement>("[data-agenda-session-dialog]")].find(
      (card) => root.querySelector<HTMLDialogElement>(`[id="${card.dataset.agendaSessionDialog}"]`)?.open,
    );
    changes.session = session ? (sessionKey(session) ?? null) : null;
    changes.agendaSession = null;
    write(changes, push);
  }
  function restore() {
    if (!sameRoute() || disposed || writing) return;
    restoring = true;
    const query = params();
    // Public fragments have their own bounded resolver; its selected panel must survive query restoration.
    const fragmentOnly =
      !portal &&
      root.hasAttribute("data-agenda-public-fragments") &&
      Boolean(splitHash().path) &&
      !query.has("session") &&
      !query.has("agendaSpeaker");
    const tab = tabs.find(
      (button) =>
        button.dataset.agendaTab ===
        ((naturalPaths ? agendaRoute(currentPath())?.[2] : null) ?? query.get("agendaDay") ?? defaultDay),
    );
    if (tab && !fragmentOnly) selectTab(tab);
    const view = query.get("agendaView") ?? defaultView;
    if (view === "grid" || view === "list") {
      root.dataset.agendaView = view;
      for (const button of root.querySelectorAll<HTMLElement>("[data-agenda-view]"))
        button.setAttribute("aria-pressed", String(button.dataset.agendaView === view));
    }
    for (const { key, input } of controls) {
      if (!input) continue;
      const value = query.get(key) ?? defaults.get(key) ?? "";
      input.value =
        input instanceof HTMLSelectElement && ![...input.options].some((option) => option.value === value)
          ? (defaults.get(key) ?? "")
          : value;
      if (key === "agendaZone") input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const compact = query.get("agendaAbstract") === "hidden" || (!query.has("agendaAbstract") && defaultCompact);
    const compactButton = root.querySelector<HTMLButtonElement>("[data-agenda-compact]");
    if (root.classList.contains("is-compact") !== compact) compactButton?.click();
    let roomChoices: unknown;
    try {
      roomChoices = JSON.parse(query.get("agendaRooms") ?? "{}");
    } catch {
      roomChoices = {};
    }
    for (const day of root.querySelectorAll<HTMLElement>("[data-agenda-location-day]")) {
      const selected =
        roomChoices && typeof roomChoices === "object"
          ? Reflect.get(roomChoices, day.dataset.agendaLocationDay!)
          : undefined;
      for (const input of day.querySelectorAll<HTMLInputElement>("[data-agenda-location]"))
        input.checked = !Array.isArray(selected) || selected.includes(input.dataset.agendaLocation);
    }
    root
      .querySelector("[data-agenda-mine-filter]")
      ?.setAttribute("aria-pressed", String(query.get("agendaMine") === "1"));
    refreshAgendaFilters(root);
    const speakerKey = query.get("agendaSpeaker");
    const sessionId = query.get("session");
    for (const dialog of fragmentOnly ? [] : root.querySelectorAll<HTMLDialogElement>("dialog[open]")) {
      const card = [...root.querySelectorAll<HTMLElement>("[data-agenda-session-dialog]")].find(
        (value) => value.dataset.agendaSessionDialog === dialog.id,
      );
      if (dialog.dataset.agendaSpeakerKey !== speakerKey && (!card || sessionKey(card) !== sessionId)) dialog.close();
    }
    const speaker = [...root.querySelectorAll<HTMLDialogElement>("dialog[data-agenda-speaker-key]")].find(
      (dialog) => dialog.dataset.agendaSpeakerKey === speakerKey,
    );
    if (speaker && !speaker.open) speaker.showModal();
    else if (sessionId && !openOccurrence(sessionId)) {
      const legacy = [...root.querySelectorAll<HTMLElement>("[data-agenda-session-dialog]")].find(
        (card) => sessionKey(card) === sessionId,
      );
      const day = legacy?.closest<HTMLElement>("[data-agenda-panel]")?.dataset.agendaPanel;
      const tab = tabs.find((button) => button.dataset.agendaTab === day);
      if (tab) selectTab(tab);
      if (legacy?.dataset.agendaSessionDialog) openSessionDialog?.(legacy.dataset.agendaSessionDialog);
    }
    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => {
      if (disposed) return;
      const position = [
        ...root.querySelectorAll<HTMLElement>("[data-agenda-panel]:not([hidden]) [data-agenda-session-dialog]"),
      ].find((card) => sessionKey(card) === query.get("agendaPosition"));
      if (position && !position.closest("[hidden]")) {
        position.scrollIntoView?.({ block: "start" });
        const offset = position.getBoundingClientRect().top - agendaStickyTop(root);
        if (offset < 0) window.scrollBy({ top: offset, behavior: "instant" });
      }
      const panel = root.querySelector<HTMLElement>("[data-agenda-panel]:not([hidden])");
      const room =
        panel &&
        [...panel.querySelectorAll<HTMLElement>("th[data-agenda-column-room]")].find(
          (header) => header.dataset.agendaColumnRoom === query.get("agendaRoom"),
        );
      if (room && panel) panel.scrollLeft += room.getBoundingClientRect().left - panel.getBoundingClientRect().left;
      restoring = false;
      // Every restored route settles on its canonical form, whether it arrived before or after the first frame.
      snapshot(false);
    });
  }
  const changed = (event: Event) => {
    if (restoring || !(event.target instanceof Element)) return;
    if (
      event instanceof KeyboardEvent &&
      (!event.target.matches("[data-agenda-tab]") || !["Home", "End", "ArrowRight", "ArrowLeft"].includes(event.key))
    )
      return;
    const relevant = event.target.closest(
      "[data-agenda-tab], [data-agenda-view], [data-agenda-search], [data-agenda-format-filter], [data-agenda-track-filter], [data-agenda-location], [data-agenda-locations-action], [data-agenda-clear-filters], [data-agenda-compact], [data-agenda-time-select], [data-agenda-mine-filter], [data-agenda-open-speaker], [data-agenda-open-session], [data-agenda-open-occurrence], [data-agenda-session-dialog], dialog",
    );
    if (relevant) {
      // Native event dispatch may checkpoint microtasks between capture and bubble listeners.
      // Commit after the controls' existing handlers have finished updating the agenda.
      const commit = setTimeout(() => {
        commits.delete(commit);
        snapshot(event.type !== "input" && event.type !== "close");
      }, 0);
      commits.add(commit);
    }
  };
  for (const name of ["click", "input", "change", "close", "keydown"])
    root.addEventListener(name, changed, { capture: true, signal: events.signal });
  const scrolled = () => {
    if (restoring) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const panel = root.querySelector<HTMLElement>("[data-agenda-panel]:not([hidden])");
      if (!panel) return;
      const position = [...panel.querySelectorAll<HTMLElement>("[data-agenda-session-dialog]")].find(
        (card) =>
          !card.closest("[hidden]") &&
          card.getBoundingClientRect().bottom > agendaStickyTop(root) &&
          card.getBoundingClientRect().top < innerHeight,
      );
      const room = [...panel.querySelectorAll<HTMLElement>("th[data-agenda-column-room]")].find(
        (header) => header.getBoundingClientRect().right > panel.getBoundingClientRect().left,
      );
      write({
        agendaPosition: position ? (sessionKey(position) ?? null) : null,
        agendaRoom: panel.scrollLeft > 0 ? (room?.dataset.agendaColumnRoom ?? null) : null,
      });
    }, 150);
  };
  window.addEventListener("scroll", scrolled, { capture: true, passive: true, signal: events.signal });
  const unsubscribe = subscribeUrlQuery(restore);
  restore();
  return () => {
    disposed = true;
    events.abort();
    unsubscribe();
    clearTimeout(scrollTimer);
    for (const commit of commits) clearTimeout(commit);
    cancelAnimationFrame(restoreFrame);
  };
}
