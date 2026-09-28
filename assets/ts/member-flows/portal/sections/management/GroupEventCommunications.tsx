/**
 * Email campaigns for one event, one audience at a time.
 *
 * The audience is a URL segment and composing a campaign is a page under it.
 */
import {
  eventEmailCampaignAudienceSchema,
  type EventEmailCampaignAudience,
} from "../../../../../shared/schemas/event-email-campaigns";
import { EventEmailCampaign } from "../../../../components/events/EventEmailCampaign";
import { ButtonLink } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select } from "../../../../ui/TextControl";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";

const AUDIENCE_LABELS: Record<EventEmailCampaignAudience, string> = {
  attendees: "Attendees",
  attendee_invitations: "Invited attendees",
  speaker_invitations: "Invited speakers",
  speakers: "Speakers",
};

const AUDIENCE_DESCRIPTIONS: Record<EventEmailCampaignAudience, string> = {
  attendee_invitations:
    "People invited as attendees, including those who accepted or whose invitation expired. Declined, revoked, and opted-out invitations are excluded.",
  speaker_invitations:
    "People invited as speakers, including those who accepted or whose invitation expired. Declined, revoked, and opted-out invitations are excluded.",
  attendees: "Everyone registered for the event, narrowed by status, attendance type, day or waitlist standing.",
  speakers: "The speakers on this event's proposals, narrowed by whether they have confirmed.",
};

const DEFAULT_AUDIENCE: EventEmailCampaignAudience = "attendees";

/** Reserved segment under an audience that opens the composer page. */
export const NEW_CAMPAIGN_SEGMENT = "new";

export function GroupEventCommunications({
  groupId,
  eventId,
  audience: requested,
  composing = false,
  audienceHref,
}: {
  groupId: string;
  eventId: string;
  /** The URL-addressed audience segment, if any. Unrecognized selects attendees. */
  audience?: string;
  /** Whether the composer page under the audience is open. */
  composing?: boolean;
  /** Where each audience lives. */
  audienceHref: (audience: EventEmailCampaignAudience) => string;
}) {
  const [, navigate] = usePortalHashLocation();
  const parsed = eventEmailCampaignAudienceSchema.safeParse(requested);
  const audience: EventEmailCampaignAudience = parsed.success ? parsed.data : DEFAULT_AUDIENCE;
  const eventPath = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`;
  const listPath = audienceHref(audience);

  if (composing) {
    return (
      <div class="pk-stack">
        <Panel aria-label={`New ${AUDIENCE_LABELS[audience].toLowerCase()} campaign`}>
          <PanelHeader title={`New ${AUDIENCE_LABELS[audience].toLowerCase()} campaign`} breadcrumb />
          <PanelBody>
            <EventEmailCampaign
              key={audience}
              campaignsPath={`${eventPath}/email/campaigns`}
              daysPath={`${eventPath}/days`}
              audience={audience}
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
    <div class="pk-stack">
      <Field label="Audience">
        {(control) => (
          <Select
            {...control}
            value={audience}
            onChange={(event) =>
              navigate(audienceHref(eventEmailCampaignAudienceSchema.parse((event.target as HTMLSelectElement).value)))
            }
          >
            {eventEmailCampaignAudienceSchema.options.map((option) => (
              <option key={option} value={option}>
                {AUDIENCE_LABELS[option]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Panel aria-label={`${AUDIENCE_LABELS[audience]} campaigns`}>
        <PanelHeader title={`${AUDIENCE_LABELS[audience]} campaigns`}>
          <ButtonLink
            size="sm"
            variant="primary"
            href={usePortalHashLocation.hrefs(`${listPath}/${NEW_CAMPAIGN_SEGMENT}`)}
          >
            New campaign
          </ButtonLink>
        </PanelHeader>
        <PanelBody>
          {/* Sent campaigns are not kept as records yet, so the panel says
              who the audience is and offers the one thing to do with it. */}
          <EmptyState
            title={`Email the ${AUDIENCE_LABELS[audience].toLowerCase()}`}
            body={AUDIENCE_DESCRIPTIONS[audience]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
