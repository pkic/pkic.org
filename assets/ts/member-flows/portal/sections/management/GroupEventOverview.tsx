import { eventClock } from "../../../../../shared/event-clock";
import { groupEventPlace } from "./group-event-place";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import {
  EVENT_PROFILE_LABELS,
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_VISIBILITY_LABELS,
} from "../../../../../shared/schemas/event-series";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { LinkList } from "../../../../ui/LinkList";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { formatDateTimeInZone } from "../../ui";
import { GroupEventGlance, type GroupEventGlanceProps } from "./GroupEventGlance";
import { GroupEventRegistrationPanel } from "./GroupEventRegistrationPanel";

/**
 * The event's overview: its standing at a glance, then its facts — beside
 * the reader's own registration prompt when they can register, and on their
 * own when they cannot, rather than beside an empty column.
 */
export function GroupEventOverview({
  event,
  groupId,
  canRegister,
  visibleTabs,
  tabHref,
}: {
  event: GroupEvent;
  groupId: string;
  canRegister: boolean;
} & Pick<GroupEventGlanceProps, "visibleTabs" | "tabHref">) {
  const facts = (
    <>
      <Panel aria-label="Schedule">
        <PanelHeader title="Schedule" />
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Starts", value: formatDateTimeInZone(event.startsAt, eventClock(event)) },
              /* Keep both endpoints in the event's time zone. */
              { term: "Ends", value: formatDateTimeInZone(event.endsAt, eventClock(event)) },
              { term: "Time zone", value: event.timezone },
              { term: "Location", value: groupEventPlace(event) },
            ]}
          />
        </PanelBody>
      </Panel>
      <Panel aria-label="Event facts">
        <PanelHeader title="Event" />
        <PanelBody>
          {/* What a planner decides about the event. Its address key and how
              its page is sourced are settings, kept under Settings. */}
          <DescriptionList
            density="compact"
            items={[
              { term: "Profile", value: EVENT_PROFILE_LABELS[event.profileKey ?? "conference"] },
              { term: "Registration", value: EVENT_REGISTRATION_POLICY_LABELS[event.registrationPolicy] },
              { term: "Visibility", value: EVENT_VISIBILITY_LABELS[event.visibility] },
            ]}
          />
        </PanelBody>
      </Panel>
      {/* Omit the links panel when the event has no links. */}
      {event.links.length > 0 && (
        <Panel aria-label="Event links">
          <PanelHeader title="Links" />
          <PanelBody>
            <LinkList links={event.links} label="Event links" />
          </PanelBody>
        </Panel>
      )}
    </>
  );
  return (
    <div class="pk-stack">
      <GroupEventGlance event={event} groupId={groupId} visibleTabs={visibleTabs} tabHref={tabHref} />
      {canRegister ? (
        <div class="pk-record">
          <div class="pk-stack">
            <GroupEventRegistrationPanel event={event} groupId={groupId} />
          </div>
          <div class="pk-stack pk-datalist-aligned">{facts}</div>
        </div>
      ) : (
        <div class="pk-grid pk-grid--cards pk-datalist-aligned">{facts}</div>
      )}
    </div>
  );
}
