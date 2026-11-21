import { EventLiveOverlayLayouts } from "./live-layouts/EventLiveOverlayLayouts";

/**
 * The event's live settings for its live moderators: the broadcast scenes and
 * the browser sources that draw them. Every room shares the scenes, so only
 * the people who set up the live studio change them; the others see them.
 */
export function EventLiveSettings({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  return <EventLiveOverlayLayouts key={slug} slug={slug} canEdit={canEdit} />;
}
