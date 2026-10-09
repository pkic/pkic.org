/**
 * The event app's bottom bar on phones: the reader's bottom tabs and the
 * More sheet holding every destination the tabs leave out. More is a button
 * that opens the sheet; swiping up on the bar opens it too.
 */
import { useCallback, useId, useState } from "preact/hooks";
import { BottomSheet } from "../../../../../ui/BottomSheet";
import { AppTabBar } from "../../../shell/AppTabBar";
import { portalSession } from "../../../state";
import { EventAppDestinations } from "./EventAppDestinations";
import { eventAppNavigation, eventAppTabFor, type EventAppSubject } from "./event-app-tabs";

export function EventAppBar({ event, activeId }: { event: EventAppSubject; activeId: string }) {
  const [open, setOpen] = useState(false);
  const sheetId = `${useId()}-more`;
  const close = useCallback(() => setOpen(false), []);
  const navigation = eventAppNavigation(event, portalSession.value);
  return (
    <>
      <AppTabBar
        scope="event"
        label="Event app"
        items={navigation.tabs}
        activeId={eventAppTabFor(activeId, navigation.tabs)}
        menu={{
          id: "more",
          label: "More",
          icon: "more",
          controls: sheetId,
          expanded: open,
          onOpen: () => setOpen(true),
        }}
      />
      <BottomSheet id={sheetId} open={open} title="More" onClose={close}>
        {/* Rendered only while open, so the page holds one copy of each destination. */}
        {open &&
          (navigation.more.length ? (
            <EventAppDestinations destinations={navigation.more} label="More event pages" onNavigate={close} />
          ) : (
            <p>Nothing else is available for this event yet.</p>
          ))}
      </BottomSheet>
    </>
  );
}
