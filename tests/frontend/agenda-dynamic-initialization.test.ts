// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { agendaLayoutCss } from "../../assets/shared/agenda-layout-css";

let root: HTMLElement | undefined;
afterEach(() => {
  root?.remove();
  vi.unstubAllGlobals();
});

it("refreshes desktop geometry for later mounts and edited rows, and releases only the disposed root's rules", async () => {
  vi.stubGlobal(
    "CSSStyleSheet",
    class {
      replaceSync = vi.fn();
    },
  );
  const unrelatedSheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [unrelatedSheet];
  const { observeAgendaLayout } = await import("../../assets/ts/site/agenda-layout-stylesheet");
  root = document.createElement("section");
  root.innerHTML = '<div data-agenda-height="280"></div>';
  document.body.append(root);
  const dispose = observeAgendaLayout(root);
  const sheet = document.adoptedStyleSheets[1]!;
  expect(sheet.replaceSync).toHaveBeenLastCalledWith(agendaLayoutCss([280]));
  root.firstElementChild!.setAttribute("data-agenda-height", "480");
  await vi.waitFor(() => expect(sheet.replaceSync).toHaveBeenLastCalledWith(agendaLayoutCss([480])));
  const laterRoot = document.createElement("section");
  laterRoot.innerHTML = '<div data-agenda-height="600"></div>';
  document.body.append(laterRoot);
  const disposeLater = observeAgendaLayout(laterRoot);
  expect(document.adoptedStyleSheets).toEqual([unrelatedSheet, sheet]);
  expect(sheet.replaceSync).toHaveBeenLastCalledWith(agendaLayoutCss([480, 600]));
  laterRoot.innerHTML = '<div data-agenda-height="720"></div>';
  await vi.waitFor(() => expect(sheet.replaceSync).toHaveBeenLastCalledWith(agendaLayoutCss([480, 720])));
  dispose();
  expect(sheet.replaceSync).toHaveBeenLastCalledWith(agendaLayoutCss([720]));
  root.firstElementChild!.setAttribute("data-agenda-height", "900");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sheet.replaceSync).toHaveBeenLastCalledWith(agendaLayoutCss([720]));
  disposeLater();
  laterRoot.remove();
  expect(document.adoptedStyleSheets).toEqual([unrelatedSheet]);
});

it("keeps the prebuilt public stylesheet and gives portal previews their own geometry rules", async () => {
  const replaceSync = vi.fn();
  vi.stubGlobal(
    "CSSStyleSheet",
    class {
      replaceSync = replaceSync;
    },
  );
  document.adoptedStyleSheets = [];
  const { observeAgendaLayout } = await import("../../assets/ts/site/agenda-layout-stylesheet");
  const link = document.createElement("link");
  link.setAttribute("data-agenda-layout", "");
  document.head.append(link);
  root = document.createElement("section");
  root.setAttribute("data-agenda-public-fragments", "");
  root.innerHTML = '<div data-agenda-height="280"></div>';
  const disposeStatic = observeAgendaLayout(root);
  expect(replaceSync).not.toHaveBeenCalled();
  root.removeAttribute("data-agenda-public-fragments");
  const disposePreview = observeAgendaLayout(root);
  expect(replaceSync).toHaveBeenLastCalledWith(agendaLayoutCss([280]));
  disposeStatic();
  expect(document.adoptedStyleSheets).toHaveLength(1);
  disposePreview();
  expect(document.adoptedStyleSheets).toEqual([]);
  link.remove();
});
it("initializes a later-mounted agenda once, switches days by keyboard, and releases listeners on disposal", async () => {
  const replaceSync = vi.fn();
  vi.stubGlobal(
    "CSSStyleSheet",
    class {
      replaceSync = replaceSync;
    },
  );
  document.adoptedStyleSheets = [];
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect = disconnect;
    },
  );
  // Import before the portal mounts: the initial document scan sees no agenda.
  const { initializeContentAgenda } = await import("../../assets/ts/site/agenda");
  root = document.createElement("section");
  root.className = "pk-content-agenda";
  root.innerHTML =
    '<button data-agenda-tab="one">Day one</button><button data-agenda-tab="two">Day two</button><div class="pk-content-agenda__day" data-agenda-panel="one"><div data-agenda-height="320"></div></div><div class="pk-content-agenda__day" data-agenda-panel="two" hidden></div>';
  document.body.append(root);
  const dispose = initializeContentAgenda(root);
  expect(replaceSync).toHaveBeenLastCalledWith(agendaLayoutCss([320]));
  expect(initializeContentAgenda(root)).toBe(dispose);
  expect(observe).toHaveBeenCalledOnce();
  const buttons = root.querySelectorAll<HTMLButtonElement>("button");
  buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(buttons[1].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(buttons[1]);
  expect(root.querySelector<HTMLElement>('[data-agenda-panel="one"]')!.hidden).toBe(true);
  dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(document.adoptedStyleSheets).toEqual([]);
  buttons[0].click();
  expect(buttons[1].getAttribute("aria-selected")).toBe("true");
});
