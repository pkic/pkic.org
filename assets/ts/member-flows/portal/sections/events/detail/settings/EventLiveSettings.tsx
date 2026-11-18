import { EventLiveOverlayLayouts } from "./live-layouts/EventLiveOverlayLayouts";
import { LiveChatArchive } from "./LiveChatArchive";

/** The event's live settings for its live moderators: the kept attendee chat, the broadcast overlay layouts and the browser sources that draw them. */
export function EventLiveSettings({ slug }: { slug: string }) {
  return (
    <div class="pk-stack">
      <LiveChatArchive key={`chat:${slug}`} slug={slug} />
      <EventLiveOverlayLayouts key={slug} slug={slug} />
    </div>
  );
}
