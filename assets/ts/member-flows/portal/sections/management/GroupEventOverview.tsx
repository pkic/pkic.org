import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import {
  EVENT_PROFILE_LABELS,
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_SOURCE_MODE_LABELS,
  EVENT_VISIBILITY_LABELS,
} from "../../../../../shared/schemas/event-series";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { LinkList } from "../../../../ui/LinkList";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { formatEventWhen } from "../../ui";
import { GroupEventRegistrationPanel } from "./GroupEventRegistrationPanel";

/** The event's overview facts and its existing registration prompt. */
export function GroupEventOverview({
  event,
  groupId,
  canRegister,
}: {
  event: GroupEvent;
  groupId: string;
  canRegister: boolean;
}) {
  return (
    <div class="pk-record">
      <div class="pk-stack">{canRegister && <GroupEventRegistrationPanel event={event} groupId={groupId} />}</div>
      <aside class="pk-stack pk-datalist-aligned">
        <Panel aria-label="Schedule">
          <PanelHeader title="Schedule" />
          <PanelBody>
            <DescriptionList
              items={[
                { term: "Starts", value: formatEventWhen(event.startsAt, event.timezone, event.location) },
                /* Keep both endpoints in the event's time zone. */
                { term: "Ends", value: formatEventWhen(event.endsAt, event.timezone, event.location) },
                { term: "Time zone", value: event.timezone },
                { term: "Location", value: event.location },
              ]}
            />
          </PanelBody>
        </Panel>
        <Panel aria-label="Event facts">
          <PanelHeader title="Event" />
          <PanelBody>
            <DescriptionList
              density="compact"
              items={[
                { term: "Profile", value: EVENT_PROFILE_LABELS[event.profileKey ?? "conference"] },
                { term: "Registration", value: EVENT_REGISTRATION_POLICY_LABELS[event.registrationPolicy] },
                { term: "Visibility", value: EVENT_VISIBILITY_LABELS[event.visibility] },
                {
                  term: "Source",
                  value: event.sourceMode ? EVENT_SOURCE_MODE_LABELS[event.sourceMode] : undefined,
                },
                { term: "Slug", value: <span class="pk-mono">{event.slug}</span> },
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
      </aside>
    </div>
  );
}
