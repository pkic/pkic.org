import { useState } from "preact/hooks";
import type { EventDetail } from "../../../../../../../shared/schemas/event-management";
import { useData } from "../../../../../../hooks/useData";
import { readEventSettings } from "../../../management/event-settings-detail";
import type { EventSettingsGroupTarget } from "./useEventSettingsSave";

/** What a settings section that loads the event itself is given. */
export interface EventSettingsSectionProps {
  slug: string;
  /** The group the event is managed through, when it is not managed directly. */
  groupId?: string;
  /** Who may change the event's settings; everyone else reads the section. */
  canEdit: boolean;
}

/**
 * The event's settings for a section that loads them itself: the event as last read or saved, and, for
 * an event managed through a group, the group's save target. A save through the group reads the event again.
 */
export function useLoadedEventSettings(slug: string, groupId?: string) {
  const loaded = useData(() => readEventSettings(slug, groupId), [slug, groupId]);
  const [saved, setSaved] = useState<EventDetail | null>(null);
  const event = saved ?? loaded.data?.event ?? null;
  const groupTarget: EventSettingsGroupTarget | undefined =
    groupId && event
      ? { groupId, eventId: event.id, canEdit: true, onSaved: () => loaded.reload().then(() => setSaved(null)) }
      : undefined;
  return { event, error: loaded.error, onUpdated: setSaved, groupTarget };
}
