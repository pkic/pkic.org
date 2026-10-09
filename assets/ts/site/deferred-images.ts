/**
 * Images that wait until the surface holding them is shown.
 *
 * A closed `<dialog>`, a closed popover and a `hidden` panel lay their images
 * out as `display: none`, and the browser's lazy loader reads that empty box as
 * intersecting the viewport: every speaker's profile portrait and directory
 * rendition would download with the first screen. Such an image is rendered
 * with its sources under `data-deferred-*` instead, keeping its dimensions and
 * text, and is given its real sources when the surface opens.
 */
const DEFERRED_ATTRIBUTES = [
  // `sizes` before `srcset` before `src`, so the first selection already knows its slot.
  ["data-deferred-sizes", "sizes"],
  ["data-deferred-srcset", "srcset"],
  ["data-deferred-src", "src"],
] as const;

const DEFERRED_SELECTOR = DEFERRED_ATTRIBUTES.map(([deferred]) => `[${deferred}]`).join(", ");
/** A surface still shut inside the one being shown keeps its own images waiting. */
const CLOSED_SURFACE = "dialog:not([open]), [popover], [hidden]";

export interface ImageSources {
  src?: unknown;
  srcSet?: unknown;
  sizes?: unknown;
}

/** The deferred spelling of an image's or `<source>`'s sources; other attributes stay as they are. */
export function deferImageSources<T extends ImageSources>({ src, srcSet, sizes, ...rest }: T) {
  return {
    ...rest,
    "data-deferred-src": typeof src === "string" ? src : undefined,
    "data-deferred-srcset": typeof srcSet === "string" ? srcSet : undefined,
    "data-deferred-sizes": typeof sizes === "string" ? sizes : undefined,
  };
}

/**
 * Give the deferred images that `container` shows their real sources. Images in
 * a surface that is still closed inside it wait for that surface; `all` reveals
 * every one, as printing does. Calling it again changes only a source that a
 * later render replaced.
 */
export function revealDeferredImages(container: Element, { all = false }: { all?: boolean } = {}): void {
  for (const image of container.querySelectorAll<HTMLElement>(DEFERRED_SELECTOR)) {
    const closed = image.parentElement?.closest(CLOSED_SURFACE);
    if (!all && closed && closed !== container && container.contains(closed)) continue;
    for (const [deferred, attribute] of DEFERRED_ATTRIBUTES) {
      const value = image.getAttribute(deferred);
      if (value !== null && image.getAttribute(attribute) !== value) image.setAttribute(attribute, value);
    }
  }
}

/**
 * Reveal each surface under `root` as it opens: a dialog gaining `open`, a
 * panel losing `hidden`, and a popover about to show. Printing reveals all of
 * them, because a printed directory or profile has no way to open later.
 */
export function observeDeferredImages(root: HTMLElement): () => void {
  const events = new AbortController();
  const observer = new MutationObserver((records) => {
    for (const { target } of records) {
      if (target instanceof HTMLElement && !target.hidden && (!(target instanceof HTMLDialogElement) || target.open))
        revealDeferredImages(target);
    }
  });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["open", "hidden"] });
  // `beforetoggle` does not bubble; a capturing listener on the root still receives it.
  root.addEventListener(
    "beforetoggle",
    (event) => {
      if ((event as ToggleEvent).newState === "open" && event.target instanceof HTMLElement)
        revealDeferredImages(event.target);
    },
    { capture: true, signal: events.signal },
  );
  window.addEventListener("beforeprint", () => revealDeferredImages(root, { all: true }), { signal: events.signal });
  return () => {
    observer.disconnect();
    events.abort();
  };
}
