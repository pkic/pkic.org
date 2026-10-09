import type { ComponentChildren } from "preact";
import type { EventFormsPurpose } from "../../../../../shared/schemas/forms";
import { Tabs } from "../../../../components/Tabs";
import { EventFormResponses } from "../../../../components/forms/management/FormManagement";
const EVENT_RESPONSES_SEGMENT = "responses";
export const CALL_SEGMENT = "call";
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
  call,
  callActive = false,
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
  /** The call for proposals, as a section of a proposal program of its own. */
  call?: ComponentChildren;
  callActive?: boolean;
}) {
  const active = badgesActive
    ? "badges"
    : callActive
      ? CALL_SEGMENT
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
          ...(call ? [{ key: CALL_SEGMENT, label: "Call for proposals" }] : []),
          ...(badges ? [{ key: "badges", label: "Badges" }] : []),
          { key: EVENT_RESPONSES_SEGMENT, label: "Responses" },
        ]}
        active={active}
        hrefFor={(key) => (key === "overview" ? basePath : `${basePath}/${key}`)}
      />
      {badgesActive ? (
        badges
      ) : callActive ? (
        call
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
