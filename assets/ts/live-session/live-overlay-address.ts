import { z } from "zod";
import { LIVE_AUX_OUTPUTS, LIVE_AUX_OUTPUT_DETAILS } from "../../shared/live-room-outputs";
import { databaseIdSchema } from "../../shared/schemas/identifiers";
import { eventSlugParamsSchema } from "../../shared/schemas/api-common";
import { liveOverlayViewSchema, type LiveOverlayView } from "../../shared/schemas/live-session-room";
import { liveOverlayLayoutSlugSchema } from "../../shared/schemas/live-overlay-layout";
import {
  ALL_LIVE_OVERLAY_GRAPHICS,
  liveOverlayGraphicsParameters,
  liveOverlayGraphicsSchema,
  parseLiveOverlayGraphics,
} from "./live-overlay-graphics";

/** The outputs a browser source can show, in the order an operator sets them up. */
export const LIVE_OVERLAY_VIEWS: ReadonlyArray<{ id: LiveOverlayView; label: string }> = [
  { id: "program", label: "Program" },
  ...LIVE_AUX_OUTPUTS.map((id) => ({ id, label: LIVE_AUX_OUTPUT_DETAILS[id].label })),
];

/** The static overlay page every broadcast browser source opens. */
export const LIVE_OVERLAY_PATH = "/live/overlay/";

const overlayAddressSchema = z.object({
  view: liveOverlayViewSchema,
  /** The scene the source always draws; null to draw whatever scene the output has on air. */
  layout: liveOverlayLayoutSlugSchema.nullable(),
  slug: eventSlugParamsSchema.shape.eventSlug,
  roomId: databaseIdSchema,
  token: z.string().min(1).max(2000),
  /** Which graphics the source draws, and whether it crops to the one left; every graphic by default. */
  graphics: liveOverlayGraphicsSchema.default(ALL_LIVE_OVERLAY_GRAPHICS),
});
export type LiveOverlayAddress = z.infer<typeof overlayAddressSchema>;

/**
 * A browser source's address, all in the fragment: a browser never sends it
 * to a server, so the access stays out of request logs and referrers and the
 * page stays static. The output, layout and graphics come first, so an
 * operator can read them: `/live/overlay/#view=program&show=checkIn&crop&event=…`.
 * Without a layout the source draws the scene the output has on air, so
 * Program matches Preview after a Take.
 */
export function liveOverlayAddress(origin: string, address: z.input<typeof overlayAddressSchema>): string {
  const parameters: Array<[string, string | null]> = [["view", address.view]];
  if (address.layout) parameters.push(["layout", address.layout]);
  parameters.push(...liveOverlayGraphicsParameters(address.graphics ?? ALL_LIVE_OVERLAY_GRAPHICS));
  parameters.push(["event", address.slug], ["room", address.roomId], ["access", address.token]);
  // Commas between graphic names stay readable; a flag such as crop carries no value.
  const fragment = parameters
    .map(([name, value]) => (value === null ? name : `${name}=${encodeURIComponent(value).replaceAll("%2C", ",")}`))
    .join("&");
  return `${origin}${LIVE_OVERLAY_PATH}#${fragment}`;
}

/**
 * Reads an overlay page's address; null when the output, room or access is
 * missing. A missing or malformed layout name reads as none.
 */
export function parseLiveOverlayAddress(location: { hash: string }): LiveOverlayAddress | null {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const layout = liveOverlayLayoutSlugSchema.safeParse(fragment.get("layout"));
  const parsed = overlayAddressSchema.safeParse({
    view: fragment.get("view"),
    layout: layout.success ? layout.data : null,
    slug: fragment.get("event"),
    roomId: fragment.get("room"),
    token: fragment.get("access"),
    graphics: parseLiveOverlayGraphics(fragment),
  });
  return parsed.success ? parsed.data : null;
}
