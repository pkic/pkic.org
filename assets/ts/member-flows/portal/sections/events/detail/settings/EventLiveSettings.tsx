import { EventLiveOverlayLayouts } from "./live-layouts/EventLiveOverlayLayouts";

/** The event's live settings: its broadcast overlay layouts and the browser sources that draw them. */
export function EventLiveSettings({ slug }: { slug: string }) {
  return <EventLiveOverlayLayouts key={slug} slug={slug} />;
}
