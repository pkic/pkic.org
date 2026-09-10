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
import {
  eventEmailCampaignAudienceSchema,
  type EventEmailCampaignAudience,
} from "../../../../../shared/schemas/event-email-campaigns";
import { EventEmailCampaign } from "../../../../components/events/EventEmailCampaign";
import { Tabs } from "../../../../components/Tabs";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { toast } from "../../ui";

/**
 * A tab per audience a campaign can address. The set is the campaign
 * contract's — the composer below sends whichever one is showing — so it is
 * derived rather than restated; the words are this page's.
 */
const AUDIENCE_LABELS: Record<EventEmailCampaignAudience, string> = {
  attendees: "Attendees",
  speakers: "Speakers",
};

const AUDIENCE_TABS = eventEmailCampaignAudienceSchema.options.map((audience) => ({
  key: audience,
  label: AUDIENCE_LABELS[audience],
}));

export function GroupEventCommunications({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [rawAudience, setAudience] = useHashQueryParam("commsTab", "attendees");
  const audience: EventEmailCampaignAudience = rawAudience === "speakers" ? "speakers" : "attendees";
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
