import { h } from "preact";
import { render } from "preact-render-to-string";
import { AgendaSpeakerProfile } from "../../assets/ts/site/AgendaSpeakerProfile";
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { initializeAgendaUrlState } from "../../assets/ts/site/agenda-url-state";
import { refreshAgendaFilters } from "../../assets/ts/site/agenda-filters";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function mount(
  url: string,
  profileMarkup = '<dialog data-agenda-speaker-key="person-123"></dialog>',
  basePath?: string,
) {
  history.replaceState(null, "", url);
  const root = document.createElement("section");
  root.dataset.agendaView = "grid";
  if (basePath) root.dataset.agendaBasePath = basePath;
  root.innerHTML = `<button data-agenda-tab="one" aria-selected="true">One</button><button data-agenda-tab="speakers">Speakers</button>
    <input data-agenda-search><select data-agenda-format-filter><option value="">All</option><option value="panel">Panel</option></select>
    <select data-agenda-track-filter><option value="">All</option><option value="security">Security</option></select>
    <button data-agenda-view="grid">Grid</button><button data-agenda-view="list">List</button><button data-agenda-compact>Abstracts</button>
    <div data-agenda-location-day="one"><input type="checkbox" checked data-agenda-location="red"><input type="checkbox" checked data-agenda-location="blue"></div>
    <section data-agenda-panel="one"><article data-agenda-occurrence="session-one" data-agenda-session="red" data-agenda-session-dialog="details" data-agenda-format="panel" data-agenda-track="security" data-agenda-search-text="cryptography"><p>Cryptography</p></article></section>
    <section data-agenda-panel="speakers" hidden><article class="pk-agenda-speaker-directory__entry"><button data-agenda-open-speaker>Alex · Security team</button></article><article class="pk-agenda-speaker-directory__entry"><button data-agenda-open-speaker>Sam · Research</button></article></section>
    <dialog id="details"></dialog>${profileMarkup}`;
  document.body.append(root);
  const select = (button: HTMLButtonElement) => {
    for (const tab of root.querySelectorAll<HTMLElement>("[data-agenda-tab]"))
      tab.setAttribute("aria-selected", String(tab === button));
    for (const panel of root.querySelectorAll<HTMLElement>("[data-agenda-panel]"))
      panel.hidden = panel.dataset.agendaPanel !== button.dataset.agendaTab;
    refreshAgendaFilters(root);
  };
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.hasAttribute("data-agenda-tab")) select(target as HTMLButtonElement);
    if (target.hasAttribute("data-agenda-view")) root.dataset.agendaView = target.dataset.agendaView;
    if (target.hasAttribute("data-agenda-compact")) root.classList.toggle("is-compact");
  });
  root.querySelectorAll("dialog").forEach((dialog) => {
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        dialog.open = true;
      },
    });
    Object.defineProperty(dialog, "close", {
      value: () => {
        dialog.open = false;
        dialog.dispatchEvent(new Event("close"));
      },
    });
  });
  const open = vi.fn((id: string) => {
    if (id !== "session-one") return false;
    root.querySelector("dialog")!.showModal();
    return true;
  });
  dispose = initializeAgendaUrlState(root, select, open, (id) =>
    root.querySelector<HTMLDialogElement>(`[id="${id}"]`)?.showModal(),
  );
  return { root, open };
}

it("restores public day, search, view and filters while preserving campaign query and canonical fragment", async () => {
  const { root } = mount(
    "/agenda/?utm_source=mail&agendaDay=speakers&agendaSearch=security&agendaView=list&agendaAbstract=hidden&agendaType=panel&agendaTrack=security&agendaRooms=%7B%22one%22%3A%5B%22red%22%5D%7D#original",
  );
  await frame();
  expect(root.querySelector('[data-agenda-panel="one"]')?.hasAttribute("hidden")).toBe(true);
  expect(root.dataset.agendaView).toBe("list");
  expect(root.classList.contains("is-compact")).toBe(true);
  expect(root.querySelector<HTMLInputElement>('[data-agenda-location="blue"]')!.checked).toBe(false);
  const speakers = [...root.querySelectorAll<HTMLElement>(".pk-agenda-speaker-directory__entry")];
  expect(speakers.map((entry) => entry.hidden)).toEqual([false, true]);
  expect(location.hash).toBe("#original");
  root.querySelector<HTMLButtonElement>('[data-agenda-tab="one"]')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(new URL(location.href).searchParams.get("agendaDay")).toBe("one");
  expect(new URL(location.href).searchParams.get("utm_source")).toBe("mail");
});

it("keeps portal router path, mine, calendar view and session while replacing live search state", async () => {
  const { root, open } = mount(
    "/portal/?utm_source=mail#/events/event/agenda?mine=1&session=session-one&view=calendar&agendaSearch=crypto",
  );
  await frame();
  expect(open).toHaveBeenCalledWith("session-one");
  const input = root.querySelector<HTMLInputElement>("[data-agenda-search]")!;
  input.value = "updated";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const hash = new URLSearchParams(location.hash.split("?")[1]);
  expect(location.hash.startsWith("#/events/event/agenda?")).toBe(true);
  expect(Object.fromEntries(hash)).toMatchObject({
    mine: "1",
    session: "session-one",
    view: "calendar",
    agendaSearch: "updated",
  });
  expect(location.search).toBe("?utm_source=mail");
});

it("restores history state and stable speaker identity, then releases native listeners on disposal", async () => {
  const { root } = mount("/agenda/?agendaSpeaker=person-123&agendaDay=speakers");
  await frame();
  expect(root.querySelector<HTMLDialogElement>("[data-agenda-speaker-key]")!.open).toBe(true);
  history.replaceState(null, "", "/agenda/?agendaDay=one&agendaView=list&agendaSearch=cryptography");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await frame();
  expect(root.querySelector<HTMLDialogElement>("[data-agenda-speaker-key]")!.open).toBe(false);
  expect(root.querySelector<HTMLInputElement>("[data-agenda-search]")!.value).toBe("cryptography");
  dispose!();
  dispose = undefined;
  history.replaceState(null, "", "/agenda/?agendaSearch=ignored");
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(root.querySelector<HTMLInputElement>("[data-agenda-search]")!.value).toBe("cryptography");
});

it("makes the initially resolved day and view bookmarkable without dropping existing route or fragment state", async () => {
  const { root } = mount("/agenda/?utm_source=initial#legacy");
  await frame();
  const state = new URL(location.href);
  expect(state.searchParams.get("agendaDay")).toBe("one");
  expect(state.searchParams.has("agendaView")).toBe(false);
  expect(state.searchParams.has("agendaAbstract")).toBe(false);
  expect(state.searchParams.get("utm_source")).toBe("initial");
  expect(state.hash).toBe("#legacy");
  dispose!();
  dispose = undefined;
  root.remove();
  const refreshed = mount(state.href);
  await frame();
  expect(refreshed.root.dataset.agendaView).toBe("grid");
  expect(refreshed.root.querySelector('[data-agenda-tab="one"]')?.getAttribute("aria-selected")).toBe("true");
});

it("bookmarks authored speaker profiles by their supplied dialog identity when no canonical speaker key exists", async () => {
  const markup = render(
    h(AgendaSpeakerProfile, { speaker: { name: "Authored legacy speaker" }, profileId: "legacy-source-profile" }),
  );
  expect(markup).toContain('data-agenda-speaker-key="legacy-source-profile"');
  const { root } = mount("/agenda/?agendaDay=speakers&agendaSpeaker=legacy-source-profile", markup);
  await frame();
  expect(root.querySelector<HTMLDialogElement>('[data-agenda-speaker-key="legacy-source-profile"]')!.open).toBe(true);
  expect(new URL(location.href).searchParams.get("agendaSpeaker")).toBe("legacy-source-profile");
});

it("restores public authored session dialogs by their existing identifier without matching a title", async () => {
  const { root } = mount("/agenda/?session=details");
  // The source-only card has a supplied dialog identifier, but no native occurrence ID.
  root.querySelector("[data-agenda-occurrence]")!.removeAttribute("data-agenda-occurrence");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await frame();
  expect(root.querySelector<HTMLDialogElement>("#details")!.open).toBe(true);
  expect(new URL(location.href).searchParams.get("session")).toBe("details");
});

it("uses clean portal speaker and date paths while preserving filters and existing personal parameters", async () => {
  const { root } = mount(
    "/portal/?utm_source=mail#/events/event/agenda?mine=1&agendaZone=venue&agendaAbstract=shown&agendaView=grid",
  );
  await frame();
  root.querySelector<HTMLButtonElement>('[data-agenda-tab="speakers"]')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(location.hash).toBe("#/events/event/agenda/speakers?mine=1");
  expect(location.search).toBe("?utm_source=mail");
  dispose!();
  dispose = undefined;
  root.remove();
  const restored = mount(location.href);
  await frame();
  expect(restored.root.querySelector('[data-agenda-tab="speakers"]')?.getAttribute("aria-selected")).toBe("true");
  const dated = restored.root.querySelector<HTMLButtonElement>('[data-agenda-tab="one"]')!;
  dated.dataset.agendaTab = "2026-12-02";
  restored.root.querySelector<HTMLElement>('[data-agenda-panel="one"]')!.dataset.agendaPanel = "2026-12-02";
  dated.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(location.hash).toBe("#/events/event/agenda/2026-12-02?mine=1");
});

it("uses generated public agenda children only when the publication supplies their canonical base", async () => {
  const { root } = mount(
    "/events/2026/conference/agenda/?utm_source=mail",
    undefined,
    "/events/2026/conference/agenda/",
  );
  await frame();
  root.querySelector<HTMLButtonElement>('[data-agenda-tab="speakers"]')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(location.pathname).toBe("/events/2026/conference/agenda/speakers/");
  expect(new URL(location.href).searchParams.get("utm_source")).toBe("mail");
  expect(new URL(location.href).searchParams.has("agendaDay")).toBe(false);
});

it("keeps embedded revision preview routes while retaining their selected agenda panel", async () => {
  const { root } = mount("/portal/#/groups/group/events/event/agenda/revisions/preview");
  await frame();
  root.querySelector<HTMLButtonElement>('[data-agenda-tab="speakers"]')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(location.hash.split("?")[0]).toBe("#/groups/group/events/event/agenda/revisions/preview");
  expect(new URLSearchParams(location.hash.split("?")[1]).get("agendaDay")).toBe("speakers");
});
