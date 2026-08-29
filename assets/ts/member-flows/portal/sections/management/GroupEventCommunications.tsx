import { useState } from "preact/hooks";
import { EventEmailCampaign } from "../../../../components/events/EventEmailCampaign";
import { Tabs } from "../../../../components/Tabs";
import { toast } from "../../ui";

type Audience = "attendees" | "speakers";

export function GroupEventCommunications({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [audience, setAudience] = useState<Audience>("attendees");
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
          onChange={(key) => setAudience(key as Audience)}
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
