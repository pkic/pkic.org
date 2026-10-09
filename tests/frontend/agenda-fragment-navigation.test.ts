// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: HTMLElement;
let dispose: (() => void) | undefined;
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.open = true;
});
const close = vi.fn(function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
});

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
  root = document.createElement("section");
  root.className = "pk-content-agenda";
  root.setAttribute("data-agenda-public-fragments", "");
  root.innerHTML = `<button id="agenda-tab-one" data-agenda-tab="one">First day</button>
    <button id="agenda-tab-two" data-agenda-tab="two">Later day</button>
    <button id="agenda-tab-speakers" data-agenda-tab="speakers">Speakers</button>
    <section id="agenda-day-one" class="pk-content-agenda__day" data-agenda-panel="one"></section>
    <section id="agenda-day-two" class="pk-content-agenda__day" data-agenda-panel="two">
      <span id="nav-wednesday" hidden data-agenda-fragment-panel="two"></span>
      <span id="nav-wednesday-tab" hidden data-agenda-fragment-panel="two"></span>
      <article id="canonical:session" data-agenda-session-dialog="native-dialog">
        <span id="sessionModal-original" hidden data-agenda-fragment-dialog="native-dialog"></span>
        <span id="sessionModal-original-label" hidden data-agenda-fragment-dialog="native-dialog"></span>
        <button data-agenda-open-session="native-dialog">Details</button>
        <dialog id="native-dialog"><h2 id="native-dialog-title">Session title</h2>
          <iframe data-video-src="https://example.test/video"></iframe></dialog>
      </article>
    </section>
    <section id="agenda-speakers" data-agenda-panel="speakers">
      <span id="speakers" hidden data-agenda-fragment-panel="speakers"></span>
      <span id="nav-speakers" hidden data-agenda-fragment-panel="speakers"></span>
    </section>`;
  document.body.append(root);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  document.body.classList.remove("agenda-modal-open");
  history.replaceState(null, "", location.pathname);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function fragment(id: string) {
  history.replaceState(null, "", `#${id}`);
}
async function initialize() {
  const { initializeContentAgenda } = await import("../../assets/ts/site/agenda");
  dispose = initializeContentAgenda(root);
}
function selected() {
  return root.querySelector('[aria-selected="true"]')?.getAttribute("data-agenda-tab");
}

it("resolves an initial later-day legacy modal and loads media through the native dialog", async () => {
  fragment("sessionModal-original");
  await initialize();
  expect(selected()).toBe("two");
  expect(showModal).toHaveBeenCalledOnce();
  expect(root.querySelector("dialog")!.open).toBe(true);
  expect(root.querySelector("iframe")!.src).toBe("https://example.test/video");
  expect(document.body.classList.contains("agenda-modal-open")).toBe(true);
});
it("resolves label, day, tab, speakers and native fragments on hash changes and removes its listener", async () => {
  await initialize();
  for (const id of ["sessionModal-original-label", "native-dialog", "native-dialog-title"]) {
    fragment(id);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(selected()).toBe("two");
    expect(root.querySelector("dialog")!.open).toBe(true);
  }
  for (const id of ["nav-wednesday", "nav-wednesday-tab", "agenda-day-two", "agenda-tab-two", "canonical%3Asession"]) {
    fragment(id);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(selected()).toBe("two");
    expect(root.querySelector("dialog")!.open).toBe(false);
  }
  expect(root.querySelector("iframe")!.hasAttribute("src")).toBe(false);
  for (const id of ["speakers", "nav-speakers", "agenda-speakers"]) {
    fragment(id);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(selected()).toBe("speakers");
  }
  dispose?.();
  dispose = undefined;
  fragment("sessionModal-original");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(selected()).toBe("speakers");
  expect(root.querySelector("dialog")!.open).toBe(false);
});
it("refuses duplicate, malformed, unknown and outside-root fragment targets", async () => {
  const duplicate = root.querySelector("#sessionModal-original")!.cloneNode(true);
  root.append(duplicate);
  fragment("sessionModal-original");
  await initialize();
  expect(selected()).toBe("one");
  expect(showModal).not.toHaveBeenCalled();
  const outside = document.createElement("dialog");
  outside.id = "outside-dialog";
  document.body.append(outside);
  for (const id of ["outside-dialog", "%ZZ", "does-not-exist", "sessionModal-original"]) {
    fragment(id);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(selected()).toBe("one");
    expect(showModal).not.toHaveBeenCalled();
  }
  outside.remove();
});
it("leaves authenticated preview and editing hashes to the portal router", async () => {
  root.removeAttribute("data-agenda-public-fragments");
  fragment("sessionModal-original");
  await initialize();
  expect(selected()).toBe("one");
  expect(showModal).not.toHaveBeenCalled();
  fragment("native-dialog-title");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(selected()).toBe("one");
  expect(showModal).not.toHaveBeenCalled();
});

it("keeps compact and expanded toggle state synchronized with the actual agenda and dialog close", async () => {
  root.insertAdjacentHTML(
    "afterbegin",
    `<button data-agenda-compact aria-pressed="true" aria-label="Hide session descriptions"><svg><path d="m4 2 4 4 4-4M4 14l4-4 4 4" /></svg></button>
    <button data-agenda-expand aria-pressed="false" aria-expanded="false" aria-label="Expand agenda"><svg><path d="original" /></svg></button>`,
  );
  await initialize();
  const compact = root.querySelector<HTMLButtonElement>("[data-agenda-compact]")!;
  compact.click();
  expect(root.classList.contains("is-compact")).toBe(true);
  expect(compact.getAttribute("aria-pressed")).toBe("false");
  expect(compact.getAttribute("aria-label")).toBe("Show session descriptions");
  expect(compact.querySelector("path")?.getAttribute("d")).toBe("m4 6 4-4 4 4M4 10l4 4 4-4");
  compact.click();
  expect(root.classList.contains("is-compact")).toBe(false);
  expect(compact.getAttribute("aria-pressed")).toBe("true");
  expect(compact.getAttribute("aria-label")).toBe("Hide session descriptions");
  expect(compact.querySelector("path")?.getAttribute("d")).toBe("m4 2 4 4 4-4M4 14l4-4 4 4");
  const expand = root.querySelector<HTMLButtonElement>("[data-agenda-expand]")!;
  expand.click();
  const dialog = document.querySelector<HTMLDialogElement>(".pk-agenda-dialog")!;
  expect(dialog.open).toBe(true);
  expect(expand.getAttribute("aria-pressed")).toBe("true");
  expect(expand.getAttribute("aria-expanded")).toBe("true");
  expect(expand.querySelector("path")?.getAttribute("d")).toBe("M6 2v4H2m12 0h-4V2M2 10h4v4m4 0v-4h4");
  dialog.close();
  expect(expand.getAttribute("aria-pressed")).toBe("false");
  expect(expand.getAttribute("aria-expanded")).toBe("false");
  expect(expand.getAttribute("aria-label")).toBe("Expand agenda");
  expect(expand.querySelector("path")?.getAttribute("d")).toBe("original");
  expect(root.parentElement).toBe(document.body);
});
