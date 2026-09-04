// @vitest-environment jsdom
/**
 * The headshot dialogs, from the accessibility tree's point of view.
 *
 * These roots used to be overlay <div>s carrying a static `aria-hidden="true"`
 * that the show path never cleared — it only added a CSS class. `aria-hidden`
 * excludes the whole subtree whatever CSS does, so the dialog, its agreement
 * checkbox, and both of its buttons were unreachable to a screen reader while
 * a sighted user was looking straight at them. The markup is imported from the
 * partial itself so that a re-added attribute fails here rather than in a
 * screen reader.
 *
 * jsdom ships <dialog> without showModal()/close(), so what the platform
 * supplies once the element is native — the focus trap, the inert page behind,
 * Escape — is not re-asserted here. What is asserted is the wiring around it:
 * the element is a dialog, nothing hides it, every way out settles the caller,
 * and focus goes back where it came from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { showHeadshotDisclaimer } from "../../assets/ts/shared/headshot/upload";
// @ts-expect-error Vite's raw-loader suffix is available to frontend tests.
import headshotModals from "../../layouts/partials/headshot-modals.html?raw";

function mountPartial(): void {
  // Hugo drops its own comments before the browser ever sees the partial, and
  // so must this: the comment names `<template>` in prose, and an HTML parser
  // reading it verbatim would open an element there and swallow the markup.
  document.body.innerHTML = String(headshotModals).replace(/\{\{\/\*[\s\S]*?\*\/\}\}/g, "");
}

function openerButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Upload headshot";
  document.body.append(button);
  button.focus();
  return button;
}

function disclaimer(): HTMLDialogElement {
  const dialog = document.getElementById("headshot-disclaimer-modal");
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("the disclaimer did not mount as a dialog");
  return dialog;
}

function control<T extends HTMLElement>(selector: string): T {
  const element = disclaimer().querySelector<T>(selector);
  if (!element) throw new Error(`the disclaimer has no ${selector}`);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("headshot disclaimer dialog", () => {
  it("mounts a dialog that assistive technology can reach", async () => {
    mountPartial();
    const settled = showHeadshotDisclaimer();

    const dialog = disclaimer();
    // The regression this file exists for: an `aria-hidden` root takes every
    // control below it out of the accessibility tree, CSS notwithstanding.
    expect(dialog.hasAttribute("aria-hidden")).toBe(false);
    expect(dialog.closest("[aria-hidden='true']")).toBeNull();
    expect(dialog.hasAttribute("open")).toBe(true);

    // A native <dialog> carries the dialog role implicitly, and showModal()
    // carries the modal semantics, so neither is restated in the markup.
    expect(dialog.getAttribute("role")).toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe("headshot-disclaimer-title");

    control<HTMLButtonElement>(".hsd-cancel").click();
    await expect(settled).resolves.toBe(false);
  });

  it("holds the confirmation back until the reader agrees, then reports it", async () => {
    mountPartial();
    const settled = showHeadshotDisclaimer({ texts: ["I hold the copyright."], confirmText: "Upload photo" });

    const confirm = control<HTMLButtonElement>(".hsd-confirm");
    const agree = control<HTMLInputElement>(".hsd-agree");
    expect(confirm.disabled).toBe(true);
    expect(control(".hsd-list").textContent).toBe("I hold the copyright.");

    agree.checked = true;
    agree.dispatchEvent(new Event("change"));
    expect(confirm.disabled).toBe(false);

    control<HTMLFormElement>(".hsd-form").dispatchEvent(new Event("submit", { cancelable: true }));

    await expect(settled).resolves.toBe(true);
    expect(document.getElementById("headshot-disclaimer-modal")).toBeNull();
  });

  it("treats the platform's close request as backing out", async () => {
    mountPartial();
    const settled = showHeadshotDisclaimer();

    // Escape and the close request both reach the page as `cancel`.
    disclaimer().dispatchEvent(new Event("cancel", { cancelable: true }));

    await expect(settled).resolves.toBe(false);
    expect(document.getElementById("headshot-disclaimer-modal")).toBeNull();
  });

  it("returns focus to the control that opened it", async () => {
    mountPartial();
    const opener = openerButton();
    const settled = showHeadshotDisclaimer();

    control<HTMLButtonElement>(".hsd-cancel").click();

    await expect(settled).resolves.toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("reports the reader declined when the page never rendered the template", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(showHeadshotDisclaimer()).resolves.toBe(false);
    expect(logged).toHaveBeenCalledWith("Headshot disclaimer template not found");
  });

  it("reports the reader declined when the template lost a control", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mountPartial();
    // Edited in the template, which is where the dialog still lives until the
    // flow clones it into the page.
    const template = document.getElementById("headshot-disclaimer-template");
    if (!(template instanceof HTMLTemplateElement)) throw new Error("the partial rendered no template");
    template.content.querySelector(".hsd-agree")?.remove();

    await expect(showHeadshotDisclaimer()).resolves.toBe(false);
    expect(logged).toHaveBeenCalledWith("Headshot disclaimer template is incomplete");
    // A half-built dialog is taken back down rather than left on the page.
    expect(document.getElementById("headshot-disclaimer-modal")).toBeNull();
  });
});
