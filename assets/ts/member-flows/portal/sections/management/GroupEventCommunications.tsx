import { useHashQueryParam } from "../../../../hooks/useHashQueryParam";
/** Event messages are composed on their own page under Communications. */
import { EventEmailCampaign } from "../../../../components/events/EventEmailCampaign";
import { ButtonLink } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";

export const NEW_CAMPAIGN_SEGMENT = "new";

export function GroupEventCommunications({
  groupId,
  eventId,
  eventSlug,
  composing = false,
  listPath,
}: {
  groupId: string;
  eventId: string;
  eventSlug: string;
  composing?: boolean;
  listPath: string;
}) {
  const [preset] = useHashQueryParam("campaignPreset", "");
  const planning = preset === "session-planning";
  const agendaUrl = new URL(`/portal/#/events/${encodeURIComponent(eventSlug)}/agenda`, window.location.origin).href;
  const [, navigate] = usePortalHashLocation();
  const eventPath = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`;

  if (composing) {
    return (
      <div class="pk-stack">
        <Panel aria-label="New event message">
          <PanelHeader title="New event message" breadcrumb />
          <PanelBody>
            <EventEmailCampaign
              campaignsPath={`${eventPath}/email/campaigns`}
              daysPath={`${eventPath}/days`}
              initialAudience="attendees"
              initialSubject={planning ? "Plan your sessions" : undefined}
              initialBody={
                planning
                  ? `Please plan the sessions you would like to attend.\n\nSave favorites to show your interest. A favorite does not register you or reserve a place. Register or request approval where the session indicates it; optional registration and invitation-only access remain separate.\n\n[Open My agenda](${agendaUrl})`
                  : undefined
              }
              notify={toast}
              cancelHref={usePortalHashLocation.hrefs(listPath)}
              onSent={() => navigate(listPath)}
            />
          </PanelBody>
        </Panel>
      </div>
    );
  }

  return (
    <Panel aria-label="Event messages">
      <PanelHeader title="Event messages">
        <ButtonLink
          size="sm"
          variant="primary"
          href={usePortalHashLocation.hrefs(`${listPath}/${NEW_CAMPAIGN_SEGMENT}`)}
        >
          New message
        </ButtonLink>
        <ButtonLink
          size="sm"
          href={usePortalHashLocation.hrefs(`${listPath}/${NEW_CAMPAIGN_SEGMENT}?campaignPreset=session-planning`)}
        >
          Ask attendees to plan sessions
        </ButtonLink>
      </PanelHeader>
      <PanelBody>
        <EmptyState
          title="Email event participants"
          body="Choose an audience and its filters in the message form, then review the recipients before sending."
        />
      </PanelBody>
    </Panel>
  );
}
