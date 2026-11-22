import { z } from "zod";
import {
  LIVE_OVERLAY_ELEMENTS,
  LIVE_OVERLAY_ELEMENT_COMPOSITIONS,
  type LiveOverlayComposition,
  type LiveOverlayElement,
  type LiveOverlayLayoutElements,
} from "../../shared/schemas/live-overlay-layout";

/**
 * Which graphics one browser source draws: all of them, only some (`show`),
 * or all but some (`hide`). With one graphic left, `crop` fits the page to
 * that graphic's box, so the production software can place it on its own.
 * `show` wins when a link carries both; the link builder never writes both.
 */
export const liveOverlayGraphicsSchema = z
  .object({
    show: z.array(z.enum(LIVE_OVERLAY_ELEMENTS)).nullable(),
    hide: z.array(z.enum(LIVE_OVERLAY_ELEMENTS)).nullable(),
    crop: z.boolean(),
  })
  .strict();
export type LiveOverlayGraphics = z.infer<typeof liveOverlayGraphicsSchema>;

/** Every graphic, uncropped: what a link without these parameters draws. */
export const ALL_LIVE_OVERLAY_GRAPHICS: LiveOverlayGraphics = { show: null, hide: null, crop: false };

/** The graphics a browser source of one composition can draw, in the editor's order. */
export function liveOverlaySourceGraphics(composition: LiveOverlayComposition = "program"): LiveOverlayElement[] {
  return LIVE_OVERLAY_ELEMENTS.filter((element) => LIVE_OVERLAY_ELEMENT_COMPOSITIONS[element].includes(composition));
}

/** Whether a source draws this graphic at all; the layout and what is on air still decide whether it shows. */
export function liveOverlayGraphicAllowed(graphics: LiveOverlayGraphics, element: LiveOverlayElement): boolean {
  if (graphics.show) return graphics.show.includes(element);
  if (graphics.hide) return !graphics.hide.includes(element);
  return true;
}

/** A layout's elements with the graphics a source leaves out hidden; every element when it draws them all. */
export function liveOverlayAllowedElements(
  elements: LiveOverlayLayoutElements,
  graphics: LiveOverlayGraphics,
): LiveOverlayLayoutElements {
  if (!graphics.show && !graphics.hide) return elements;
  const entries = Object.entries(elements) as Array<
    [LiveOverlayElement, LiveOverlayLayoutElements[LiveOverlayElement]]
  >;
  return Object.fromEntries(
    entries.map(([element, placement]) => [
      element,
      liveOverlayGraphicAllowed(graphics, element) ? placement : { ...placement, visible: false },
    ]),
  ) as LiveOverlayLayoutElements;
}

/** The one graphic a cropped source fits its page to; null unless crop is on and exactly one graphic is left. */
export function liveOverlayCropElement(
  graphics: LiveOverlayGraphics,
  composition: LiveOverlayComposition = "program",
): LiveOverlayElement | null {
  if (!graphics.crop) return null;
  const left = liveOverlaySourceGraphics(composition).filter((element) => liveOverlayGraphicAllowed(graphics, element));
  return left.length === 1 ? left[0]! : null;
}

const graphicNames = (value: string | null): LiveOverlayElement[] | null => {
  if (value === null) return null;
  const names = new Set<string>(value.split(","));
  return LIVE_OVERLAY_ELEMENTS.filter((element) => names.has(element));
};

/**
 * Reads the graphics parameters from a source's fragment. Unknown names are
 * left out: a `show` naming none the page knows draws nothing rather than
 * everything, so a mistyped link never puts every graphic on a stream.
 */
export function parseLiveOverlayGraphics(fragment: URLSearchParams): LiveOverlayGraphics {
  const show = graphicNames(fragment.get("show"));
  return { show, hide: show ? null : graphicNames(fragment.get("hide")), crop: fragment.has("crop") };
}

/** The graphics parameters in a source's fragment, in order; none for every graphic, uncropped. */
export function liveOverlayGraphicsParameters(graphics: LiveOverlayGraphics): Array<[string, string | null]> {
  const parameters: Array<[string, string | null]> = [];
  if (graphics.show) parameters.push(["show", graphics.show.join(",")]);
  else if (graphics.hide?.length) parameters.push(["hide", graphics.hide.join(",")]);
  if (graphics.crop) parameters.push(["crop", null]);
  return parameters;
}
