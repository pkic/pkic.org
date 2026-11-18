import { EventLiveOverlayLayouts } from "./live-layouts/EventLiveOverlayLayouts";

/** The event's live settings for its live moderators: the broadcast scenes and the browser sources that draw them. */
export function EventLiveSettings({ slug }: { slug: string }) {
  return <EventLiveOverlayLayouts key={slug} slug={slug} />;
}
