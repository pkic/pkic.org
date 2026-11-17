import { EventLiveOverlayLayouts } from "./live-layouts/EventLiveOverlayLayouts";
import { LiveChatRetentionSettings } from "./LiveChatRetentionSettings";

/** The event's live settings: how long the chat is kept, its broadcast overlay layouts and the browser sources that draw them. */
export function EventLiveSettings({
  slug,
  groupId,
  canConfigureChat = false,
}: {
  slug: string;
  groupId?: string;
  /** Who may change the event's settings also chooses how long the chat is kept; live moderators see only the layouts. */
  canConfigureChat?: boolean;
}) {
  return (
    <div class="pk-stack">
      {canConfigureChat && <LiveChatRetentionSettings key={`chat:${slug}`} slug={slug} groupId={groupId} />}
      <EventLiveOverlayLayouts key={slug} slug={slug} />
    </div>
  );
}
