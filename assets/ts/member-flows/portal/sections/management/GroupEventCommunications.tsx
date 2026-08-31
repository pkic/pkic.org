import { useHashQueryParam } from "../../../../hooks/useHashQueryParam";
import { EventEmailCampaign } from "../../../../components/events/EventEmailCampaign";
import { Tabs } from "../../../../components/Tabs";
import { toast } from "../../ui";

type Audience = "attendees" | "speakers";

export function GroupEventCommunications({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [rawAudience, setAudience] = useHashQueryParam("commsTab", "attendees");
  const audience: Audience = rawAudience === "speakers" ? "speakers" : "attendees";
  const eventPath = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`;
  return (
    <details class="border-top pt-3">
      <summary class="fw-semibold">Email campaigns</summary>
      <div class="pt-3">
        <Tabs
          items={[
            { key: "attendees", label: "Attendees" },
            { key: "speakers", label: "Speakers" },
          ]}
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
  );
}
