/**
 * Email campaigns for one event, one audience at a time.
 *
 * The audience is a URL segment — `…/communications` for attendees,
 * `…/communications/speakers` — and composing a campaign is a page under it
 * (`…/new`) with its own address, rather than a composer standing open the
 * moment the tab is opened: a create action is never loaded inline. The tab
 * itself states what each audience is and offers the one command it has.
 */
import {
  eventEmailCampaignAudienceSchema,
  type EventEmailCampaignAudience,
} from "../../../../../shared/schemas/event-email-campaigns";
import { EventEmailCampaign } from "../../../../components/events/EventEmailCampaign";
import { Tabs } from "../../../../components/Tabs";
import { ButtonLink } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";

/**
 * A tab per audience a campaign can address. The set is the campaign
 * contract's — the composer sends whichever one is showing — so it is
 * derived rather than restated; the words are this page's.
 */
const AUDIENCE_LABELS: Record<EventEmailCampaignAudience, string> = {
  attendees: "Attendees",
  attendee_invitations: "Invited attendees",
  speaker_invitations: "Invited speakers",
  speakers: "Speakers",
};

const AUDIENCE_DESCRIPTIONS: Record<EventEmailCampaignAudience, string> = {
  attendee_invitations:
    "People with an open attendee invitation. Accepted, declined, revoked, expired, and opted-out invitations are excluded.",
  speaker_invitations:
    "People with an open speaker invitation. Accepted, declined, revoked, expired, and opted-out invitations are excluded.",
  attendees: "Everyone registered for the event, narrowed by status, attendance type, day or waitlist standing.",
  speakers: "The speakers on this event's proposals, narrowed by whether they have confirmed.",
};

const DEFAULT_AUDIENCE: EventEmailCampaignAudience = "attendees";

/** Reserved segment under an audience that opens the composer page. */
export const NEW_CAMPAIGN_SEGMENT = "new";

const AUDIENCE_TABS = eventEmailCampaignAudienceSchema.options.map((audience) => ({
  key: audience,
  label: AUDIENCE_LABELS[audience],
}));

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
      {/* The tab set is named, so it is not one of several anonymous
          "Sections" strips when a reader lists the page's landmarks. */}
      <Tabs
        label="Campaign audience"
        items={AUDIENCE_TABS}
        active={audience}
        hrefFor={(key) => audienceHref(eventEmailCampaignAudienceSchema.parse(key))}
      />
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
