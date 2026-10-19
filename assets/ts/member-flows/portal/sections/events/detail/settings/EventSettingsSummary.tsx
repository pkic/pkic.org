import { DataTable } from "../../../../../../ui/DataTable";
import { IconCheckmark, IconPresentation } from "../../../../../../ui/MediaIcons";
import { sessionTypeName } from "../../../../../../../shared/proposal-session-types";
import type { EventSettingsSection } from "./GeneralTab";
import { eventClock } from "../../../../../../../shared/event-clock";
import type { ComponentChildren } from "preact";
import type { EventDetail } from "../../types";
import {
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_VISIBILITY_LABELS,
} from "../../../../../../../shared/schemas/event-series";
import { formatNumber } from "../../../../../../../shared/format-number";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { Alert } from "../../../../../../ui/Alert";
import { countryName } from "../../../../../../../shared/countries";
import { eventPlaceNeeded } from "../../../../../../../shared/event-place";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";

export function EventSettingsSummary({
  event,
  section = "general",
  canEdit = event.capabilities.includes("write"),
  actions,
  outcome,
  proposalFormKey,
  registrationFormKey,
}: {
  event: EventDetail;
  section?: EventSettingsSection;
  canEdit?: boolean;
  proposalFormKey: string | null | undefined;
  registrationFormKey: string | null | undefined;
  actions?: ComponentChildren;
  outcome: { tone: "ok" | "danger"; message: string } | null;
}) {
  const zone = eventClock({ ...event, timezone: event.timezone ?? "UTC" });
  const date = (value: string | null | undefined) => (value ? formatDateTimeInZone(value, zone) : "Not scheduled");
  const formLabel = (key: string | null | undefined) => (key === null ? "No form" : (key ?? "Default form"));
  return (
    <div class="pk-stack">
      {!canEdit && (
        <Alert tone="info" title="Read-only">
          You can view these settings but not change them.
        </Alert>
      )}
      {section === "location" && eventPlaceNeeded(event) && (
        <Alert tone="warn" title="City and country needed">
          Add the city and country where this event takes place. Event pages, calendar invites and badges show them, and
          the city names the event&rsquo;s clock.
        </Alert>
      )}
      {(section === "general" || section === "location") && (
        <Panel>
          <PanelHeader title={section === "location" ? "Schedule and location" : "Event details"} headingLevel={2}>
            {actions}
          </PanelHeader>
          <PanelBody>
            <DescriptionList
              items={
                section === "general"
                  ? [
                      { term: "Event name", value: event.name },
                      { term: "Slug", value: event.slug },
                      { term: "Hero image", value: event.heroImageUrl },
                    ]
                  : [
                      { term: "Starts", value: date(event.startsAt) },
                      { term: "Ends", value: date(event.endsAt) },
                      { term: "Time zone", value: event.timezone },
                      { term: "City", value: event.city },
                      { term: "Country", value: event.country ? countryName(event.country) : null },
                      { term: "Venue", value: event.venue },
                    ]
              }
            />
          </PanelBody>
        </Panel>
      )}
      {section === "session-types" && (
        <Panel>
          <PanelHeader title="Session types" headingLevel={2}>
            {actions}
          </PanelHeader>
          <PanelBody>
            <DataTable
              caption="Session types"
              rows={event.sessionTypes ?? []}
              rowKey={(type) => type.label}
              empty="No session types configured."
              narrowLayout="columns"
              columns={[
                {
                  id: "name",
                  header: "Name",
                  width: "primary",
                  cell: (type) => <span class="pk-table__wrap">{sessionTypeName(type)}</span>,
                },
                {
                  id: "duration",
                  header: "Minutes",
                  align: "end",
                  width: "fit",
                  cell: (type) => (type.durationMinutes === undefined ? null : formatNumber(type.durationMinutes)),
                },
                {
                  id: "presentation",
                  header: "Presentation required",
                  headerIcon: <IconPresentation />,
                  width: "fit",
                  align: "center",
                  cell: (type) =>
                    type.requiresPresentation ? (
                      <span class="pk-table__icon" role="img" aria-label="Required">
                        <IconCheckmark />
                      </span>
                    ) : (
                      <span class="pk-sr-only">Not required</span>
                    ),
                },
              ]}
            />
          </PanelBody>
        </Panel>
      )}
      {section === "registration" && (
        <Panel>
          <PanelHeader title="Visibility and registration" headingLevel={2}>
            {actions}
          </PanelHeader>
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
      )}
      {outcome && <Alert tone={outcome.tone}>{outcome.message}</Alert>}
    </div>
  );
}
