import type { ComponentChildren } from "preact";
import type { EventFormsPurpose } from "../../../../../shared/schemas/forms";
import { Tabs } from "../../../../components/Tabs";
import { EventFormResponses } from "../../../../components/forms/management/FormManagement";
const EVENT_RESPONSES_SEGMENT = "responses";
export function GroupEventRecordSections({
  label,
  basePath,
  responsesActive,
  eventSlug,
  purpose,
  children,
  speakers,
  speakersActive = false,
  badges,
  badgesActive = false,
}: {
  label: string;
  basePath: string;
  responsesActive: boolean;
  eventSlug: string;
  purpose: EventFormsPurpose;
  children: ComponentChildren;
  speakers?: ComponentChildren;
  speakersActive?: boolean;
  badges?: ComponentChildren;
  badgesActive?: boolean;
}) {
  const active = badgesActive
    ? "badges"
    : speakersActive
      ? "speakers"
      : responsesActive
        ? EVENT_RESPONSES_SEGMENT
        : "overview";
  return (
    <div class="pk pk-stack">
      <Tabs
        label={`${label} sections`}
        items={[
          { key: "overview", label: "Overview" },
          ...(speakers ? [{ key: "speakers", label: "Speakers" }] : []),
          ...(badges ? [{ key: "badges", label: "Badges" }] : []),
          { key: EVENT_RESPONSES_SEGMENT, label: "Responses" },
        ]}
        active={active}
        hrefFor={(key) => (key === "overview" ? basePath : `${basePath}/${key}`)}
      />
      {badgesActive ? (
        badges
      ) : speakersActive ? (
        speakers
      ) : responsesActive ? (
        <EventFormResponses eventSlug={eventSlug} purpose={purpose} />
      ) : (
        children
      )}
    </div>
  );
}
