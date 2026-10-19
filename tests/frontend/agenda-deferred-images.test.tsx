// @vitest-environment jsdom
import { render, renderToStringAsync } from "preact-render-to-string";
import { h } from "preact";
import { Suspense } from "preact/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { initializeContentAgenda } from "../../assets/ts/site/agenda";
import { DeferredImages, SiteImage, configureSiteImages } from "../../assets/ts/site/SiteImage";
import { observeDeferredImages, revealDeferredImages } from "../../assets/ts/site/deferred-images";
import type { ContentAgendaDay, ContentAgendaSpeaker } from "../../assets/shared/site-agenda";

const PORTRAIT = "/api/v1/users/00000000-0000-4000-8000-000000000001/headshots/2026-01-01T00-00-00-000Z-abcd1234.jpg";
const speaker: ContentAgendaSpeaker = {
  name: "Synthetic Speaker",
  speakerKey: "synthetic-speaker",
  affiliations: [{ title: "Researcher" }],
  imageSrc: PORTRAIT,
};
const days: ContentAgendaDay[] = [
  {
    date: "2026-12-01",
    locations: [{ id: "blue", label: "Blue" }],
    slots: [
      {
        startsAt: "2026-12-01T08:00:00.000Z",
        time: "09:00",
        sessions: [
          {
            id: "keynote",
            title: "Keynote",
            kind: "session",
            locations: ["blue"],
            speakers: [speaker],
            descriptionHtml: "<p>Details</p>",
            endsAt: "2026-12-01T08:45:00.000Z",
          },
        ],
      },
    ],
  },
];

let dispose: (() => void) | undefined;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "CSSStyleSheet",
    class {
      replaceSync() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  document.adoptedStyleSheets = [];
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  host.remove();
  configureSiteImages();
  vi.unstubAllGlobals();
});

/** Mutation records arrive as a microtask after the attribute change. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const loaded = (image: Element | null) => image?.getAttribute("src") ?? null;

function mount() {
  host.innerHTML = render(<ContentAgenda days={days} speakers={[speaker]} timeZone="Europe/Amsterdam" />);
  const root = host.querySelector<HTMLElement>(".pk-content-agenda")!;
  dispose = initializeContentAgenda(root);
  return root;
}

describe("deferred agenda images", () => {
  it("loads only the card portraits until a dialog or the Speakers tab is shown", async () => {
    const root = mount();
    const card = root.querySelector(".pk-agenda-speaker__open .pk-avatar__img")!;
    expect(loaded(card)).toBe(`${PORTRAIT}?width=96`);

    const modal = root.querySelector<HTMLDialogElement>("dialog.session-modal")!;
    const directory = root.querySelector<HTMLElement>('[data-agenda-panel="speakers"]')!;
    const deferred = [...root.querySelectorAll(".pk-avatar__img")].filter((image) => image !== card);
    expect(deferred.length).toBeGreaterThan(0);
    for (const image of deferred) {
      expect(image.hasAttribute("src")).toBe(false);
      expect(image.hasAttribute("srcset")).toBe(false);
      expect(image.getAttribute("data-deferred-src")).toMatch(new RegExp(`^${PORTRAIT}`));
    }
    expect(directory.hidden).toBe(true);

    root.querySelector<HTMLElement>(`[data-agenda-open-session="${modal.id}"]`)!.click();
    await settle();
    const modalPortrait = modal.querySelector(
      ".session-modal__body .pk-agenda-speaker > .pk-content-agenda__speaker .pk-avatar__img",
    )!;
    expect(loaded(modalPortrait)).toBe(`${PORTRAIT}?width=96`);
    expect(modalPortrait.getAttribute("sizes")).toBe("2.5rem");
    expect(modalPortrait.getAttribute("srcset")).toContain(`${PORTRAIT}?width=384 384w`);
    // The speaker's one profile is rendered beside the program, not nested in the session, and waits for its dialog.
    expect(modal.querySelector("dialog[data-agenda-speaker-dialog]")).toBeNull();
    const profile = root.querySelector<HTMLDialogElement>(
      "[data-agenda-speaker-profiles] dialog[data-agenda-speaker-dialog]",
    )!;
    const profilePortrait = profile.querySelector(".pk-agenda-speaker-profile__portrait .pk-avatar__img")!;
    expect(loaded(profilePortrait)).toBeNull();

    root.querySelector<HTMLButtonElement>('[data-agenda-tab="speakers"]')!.click();
    await settle();
    expect(directory.hidden).toBe(false);
    const directoryPortrait = directory.querySelector(".pk-agenda-speaker-directory__card .pk-avatar__img")!;
    expect(loaded(directoryPortrait)).toBe(PORTRAIT);
    expect(directoryPortrait.getAttribute("sizes")).toBe("auto, 20rem");
    expect(directory.querySelector("dialog[data-agenda-speaker-dialog]")).toBeNull();
    expect(loaded(profilePortrait)).toBeNull();

    directory.querySelector<HTMLButtonElement>(".pk-agenda-speaker-directory__card")!.click();
    await settle();
    // The directory entry opens the same single profile the session cards open.
    expect(profile.open).toBe(true);
    // The profile header's portrait loads a bounded rendition once its dialog opens.
    expect(loaded(profilePortrait)).toBe(`${PORTRAIT}?width=96`);
    expect(profilePortrait.getAttribute("srcset")).toContain(`${PORTRAIT}?width=384 384w`);
  });

  it("reveals every image before printing", async () => {
    const root = mount();
    expect(root.querySelectorAll(".pk-avatar__img:not([src])").length).toBeGreaterThan(0);

    window.dispatchEvent(new Event("beforeprint"));
    expect(root.querySelectorAll(".pk-avatar__img:not([src])").length).toBe(0);
  });

  it("is idempotent, follows a replaced source and stops observing once disposed", async () => {
    const root = document.createElement("section");
    root.innerHTML = '<dialog><img alt="" width="96" height="96" data-deferred-src="/a.webp"></dialog>';
    host.append(root);
    const stop = observeDeferredImages(root);
    const dialog = root.querySelector("dialog")!;
    const image = root.querySelector("img")!;
    dialog.setAttribute("open", "");
    await settle();
    expect(loaded(image)).toBe("/a.webp");
    revealDeferredImages(dialog);
    expect(loaded(image)).toBe("/a.webp");
    image.setAttribute("data-deferred-src", "/b.webp");
    revealDeferredImages(dialog);
    expect(loaded(image)).toBe("/b.webp");
    expect([image.getAttribute("width"), image.getAttribute("height")]).toEqual(["96", "96"]);

    stop();
    dialog.removeAttribute("open");
    image.setAttribute("data-deferred-src", "/c.webp");
    dialog.setAttribute("open", "");
    await settle();
    expect(loaded(image)).toBe("/b.webp");
  });

  it("defers published picture sources but keeps their dimensions and text", async () => {
    configureSiteImages(async () => ({
      src: "/_assets/portrait.webp",
      srcSet: "/_assets/portrait-128.webp 128w, /_assets/portrait.webp 384w",
      avifSrcSet: "/_assets/portrait-128.avif 128w, /_assets/portrait.avif 384w",
      width: 384,
      height: 384,
    }));
    const markup = await renderToStringAsync(
      h(
        "div",
        null,
        h(
          Suspense,
          { fallback: null },
          h(DeferredImages, null, h(SiteImage, { src: "/portrait.jpg", alt: "Portrait", portrait: true })),
        ),
      ),
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const [image, source] = [container.querySelector("img")!, container.querySelector("source")!];
    expect(image.hasAttribute("src")).toBe(false);
    expect(source.hasAttribute("srcset")).toBe(false);
    expect([image.alt, image.getAttribute("width"), image.getAttribute("height")]).toEqual(["Portrait", "384", "384"]);
    expect(image.getAttribute("data-deferred-src")).toBe("/_assets/portrait.webp");
    expect(source.getAttribute("data-deferred-srcset")).toContain("/_assets/portrait.avif 384w");

    revealDeferredImages(container);
    expect(source.getAttribute("srcset")).toContain("/_assets/portrait.avif 384w");
    expect(source.getAttribute("sizes")).toBe("auto, 96px");
    expect(image.getAttribute("srcset")).toContain("/_assets/portrait.webp 384w");
    expect(loaded(image)).toBe("/_assets/portrait.webp");
  });

  it("gives a reader without scripts the deferred image from a noscript copy after the picture", async () => {
    configureSiteImages(async () => ({
      src: "/_assets/portrait.webp",
      srcSet: "/_assets/portrait-128.webp 128w",
      avifSrcSet: "/_assets/portrait-128.avif 128w",
      width: 128,
      height: 128,
    }));
    const markup = await renderToStringAsync(
      h(
        Suspense,
        { fallback: null },
        h(DeferredImages, null, h(SiteImage, { src: "/portrait.jpg", alt: "Portrait", portrait: true })),
      ),
    );
    expect(markup).toMatch(/<\/picture><noscript><img src="\/_assets\/portrait\.webp"[^>]*alt="Portrait"/);
    expect(markup).not.toMatch(/<picture[^>]*>[^]*<noscript>[^]*<\/picture>/);
  });
});
