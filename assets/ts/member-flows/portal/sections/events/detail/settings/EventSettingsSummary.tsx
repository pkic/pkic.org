import type { ComponentChildren } from "preact";
import type { EventDetail } from "../../types";
import {
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_VISIBILITY_LABELS,
} from "../../../../../../../shared/schemas/event-series";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { Alert } from "../../../../../../ui/Alert";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";

export function EventSettingsSummary({
  event,
  actions,
  outcome,
  proposalFormKey,
  registrationFormKey,
}: {
  event: EventDetail;
  proposalFormKey: string | null | undefined;
  registrationFormKey: string | null | undefined;
  actions?: ComponentChildren;
  outcome: { tone: "ok" | "danger"; message: string } | null;
}) {
  const zone = event.timezone ?? "UTC";
  const date = (value: string | null | undefined) => (value ? formatDateTimeInZone(value, zone) : "Not scheduled");
  const formLabel = (key: string | null | undefined) => (key === null ? "No form" : (key ?? "Default form"));
  return (
    <div class="pk-stack">
      {!event.capabilities.includes("write") && (
        <Alert tone="info" title="Read-only">
          You can view these settings but not change them.
        </Alert>
      )}
      <Panel>
        <PanelHeader title="Event details" headingLevel={2}>
          {actions}
        </PanelHeader>
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Event name", value: event.name },
              { term: "Slug", value: event.slug },
              { term: "Starts", value: date(event.startsAt) },
              { term: "Ends", value: date(event.endsAt) },
              { term: "Venue", value: event.venue },
              {
                term: "Virtual URL",
                value: event.virtualUrl ? <a href={event.virtualUrl}>{event.virtualUrl}</a> : null,
              },
              { term: "Hero image", value: event.heroImageUrl },
              { term: "Location label", value: event.location },
            ]}
          />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="Session types" headingLevel={2} />
        <PanelBody>
          <DescriptionList
            items={(event.sessionTypes ?? []).map((type) => ({
              term: type.label,
              value: type.requiresPresentation ? "Presentation required" : "Presentation optional",
            }))}
          />
          {!event.sessionTypes?.length && <p>No session types configured.</p>}
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="Visibility and registration" headingLevel={2} />
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Event visibility", value: EVENT_VISIBILITY_LABELS[event.visibility] },
              ...(event.sourceMode === "portal"
                ? []
                : [{ term: "Registration mode", value: EVENT_REGISTRATION_POLICY_LABELS[event.registrationPolicy] }]),
              { term: "Invite limit per attendee", value: event.inviteLimitAttendee },
              { term: "User retention (days)", value: event.userRetentionDays ?? "No policy" },
              ...(event.sourceMode === "portal"
                ? []
                : [{ term: "Registration form", value: formLabel(registrationFormKey) }]),
              {
                term: "Proposal form",
                value: formLabel(proposalFormKey),
              },
            ]}
          />
        </PanelBody>
      </Panel>
      {outcome && <Alert tone={outcome.tone}>{outcome.message}</Alert>}
    </div>
  );
}
