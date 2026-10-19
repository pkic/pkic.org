import { z } from "zod";
import { LIVE_AUX_OUTPUTS, LIVE_AUX_OUTPUT_DETAILS } from "../../shared/live-room-outputs";
import { databaseIdSchema } from "../../shared/schemas/identifiers";
import { eventSlugParamsSchema } from "../../shared/schemas/api-common";
import { liveOverlayViewSchema, type LiveOverlayView } from "../../shared/schemas/live-session-room";
import { LIVE_OVERLAY_DEFAULT_LAYOUT, liveOverlayLayoutSlugSchema } from "../../shared/schemas/live-overlay-layout";

/** The outputs a browser source can show, in the order an operator sets them up. */
export const LIVE_OVERLAY_VIEWS: ReadonlyArray<{ id: LiveOverlayView; label: string }> = [
  { id: "program", label: "Program" },
  ...LIVE_AUX_OUTPUTS.map((id) => ({ id, label: LIVE_AUX_OUTPUT_DETAILS[id].label })),
];

/** The static overlay page every broadcast browser source opens. */
export const LIVE_OVERLAY_PATH = "/live-overlay/";

const overlayAddressSchema = z.object({
  view: liveOverlayViewSchema,
  layout: liveOverlayLayoutSlugSchema,
  slug: eventSlugParamsSchema.shape.eventSlug,
  roomId: databaseIdSchema,
  token: z.string().min(1).max(2000),
});
export type LiveOverlayAddress = z.infer<typeof overlayAddressSchema>;

/**
 * A browser source's address. The output and the layout ride the query, so
 * an operator can read them and set up one source per scene:
 * `/live-overlay/?view=program&layout=lower-third`. The physical room and
 * the access ride the fragment, which a browser never sends to a server, so
 * they stay out of request logs and referrers. The default layout is left
 * out of the query.
 */
export function liveOverlayAddress(origin: string, address: LiveOverlayAddress): string {
  const query = new URLSearchParams({ view: address.view });
  if (address.layout !== LIVE_OVERLAY_DEFAULT_LAYOUT) query.set("layout", address.layout);
  const fragment = new URLSearchParams({ event: address.slug, room: address.roomId, access: address.token });
  return `${origin}${LIVE_OVERLAY_PATH}?${query}#${fragment}`;
}

/**
 * Reads an overlay page's address; null when the output, room or access is
 * missing. A missing or malformed layout name reads as the default one.
 */
export function parseLiveOverlayAddress(location: { search: string; hash: string }): LiveOverlayAddress | null {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const layout = liveOverlayLayoutSlugSchema.safeParse(query.get("layout"));
  const parsed = overlayAddressSchema.safeParse({
    view: query.get("view"),
    layout: layout.success ? layout.data : LIVE_OVERLAY_DEFAULT_LAYOUT,
    slug: fragment.get("event"),
    roomId: fragment.get("room"),
    token: fragment.get("access"),
  });
  return parsed.success ? parsed.data : null;
}
