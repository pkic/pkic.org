/**
 * Email campaigns for one event, as a disclosure inside its own panel.
 *
 * `<details>` is kept rather than rebuilt: it is already a disclosure the
 * keyboard and a screen reader both understand, so it needs no role, no
 * handler and no state. The separating rule the Bootstrap version drew with a
 * `border-top` is the panel's own edge here, and the padding that followed it
 * is the stack's gap.
 */
import { useHashQueryParam } from "../../../../hooks/useHashQueryParam";
import { EventEmailCampaign } from "../../../../components/events/EventEmailCampaign";
import { Tabs } from "../../../../components/Tabs";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { toast } from "../../ui";

type Audience = "attendees" | "speakers";

const AUDIENCE_TABS = [
  { key: "attendees", label: "Attendees" },
  { key: "speakers", label: "Speakers" },
];

export function GroupEventCommunications({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [rawAudience, setAudience] = useHashQueryParam("commsTab", "attendees");
  const audience: Audience = rawAudience === "speakers" ? "speakers" : "attendees";
  const eventPath = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`;
  return (
    <Panel>
      <PanelBody>
        <details>
          <summary class="pk-strong">Email campaigns</summary>
          <div class="pk-stack">
            {/* The tab set is named, so it is not one of several anonymous
                "Sections" strips when a reader lists the page's landmarks. */}
            <Tabs
              label="Campaign audience"
              items={AUDIENCE_TABS}
              active={audience}
              onChange={(key) => setAudience(key)}
            />
            <EventEmailCampaign
              campaignsPath={`${eventPath}/email/campaigns`}
              daysPath={`${eventPath}/days`}
              audience={audience}
              notify={toast}
            />
          </div>
        </details>
      </PanelBody>
    </Panel>
  );
}
