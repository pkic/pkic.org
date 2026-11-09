import { InviteColleagueButton } from "../../../../../../components/event-invites/InviteColleagueButton";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { useData } from "../../../../../../hooks/useData";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { SharePanel, extractOgBadgeUrl, type SharePanelOptions } from "../../../../../../shared/widgets/share-panel";
import { promotionSessionListSchema } from "../../../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../../../shared/api-client";
import { promotionResourcePath } from "./promotion-kit-client";
import { PersonalPromotionKit } from "./PersonalPromotionKit";
import { PromotionBadgeTile } from "./PromotionBadgeTile";

/** Everything a participant shares for one event: their materials, then their invite link. */
export function MyPromotionKits({
  slug,
  attendeeEligible = false,
  canInvite = false,
  speakerEligible = true,
  share,
  userId,
}: {
  slug: string;
  attendeeEligible?: boolean;
  canInvite?: boolean;
  speakerEligible?: boolean;
  share?: SharePanelOptions;
  userId?: string;
}) {
  const event = `/api/v1/events/${encodeURIComponent(slug)}`;
  const target = userId ? new URLSearchParams({ userId }) : undefined;
  const listing = useData(
    async () =>
      speakerEligible
        ? getJson(
            promotionResourcePath(event, "agenda/promotion", userId ? new URLSearchParams({ userId }) : undefined),
            promotionSessionListSchema,
          )
        : null,
    [event, speakerEligible, userId],
  );
  const sessions = listing.data?.occurrences ?? [];
  const registered = listing.data?.attendeeEligible ?? false;
  const badgeUrl = share && extractOgBadgeUrl(share.shareUrl, share.badgeVersion);
  return (
    <div class="pk-stack">
      {listing.error && <ErrorAlert error={listing.error} />}
      {listing.loading && <Spinner label="Loading promotion materials…" />}
      {!listing.loading && !listing.error && !sessions.length && !attendeeEligible && !registered && (
        <EmptyState
          title="No promotion materials available yet"
          body="Speaker materials become available when assigned sessions are published."
        />
      )}
      {sessions.map((session) => (
        <PersonalPromotionKit
          key={session.id}
          base={promotionResourcePath(event, `agenda/occurrences/${encodeURIComponent(session.id)}/promotion`, target)}
          readOnly={Boolean(userId)}
          title={session.title}
        />
      ))}
      {(attendeeEligible || (userId && registered)) && (
        <PersonalPromotionKit
          base={promotionResourcePath(event, "promotion", target)}
          readOnly={Boolean(userId)}
          title="Your attendee materials"
          leading={badgeUrl && <PromotionBadgeTile badgeUrl={badgeUrl} />}
        />
      )}
      {share && (
        <SharePanel
          options={{ ...share, hideBadge: true }}
          inviteAction={canInvite && !userId ? <InviteColleagueButton eventSlug={slug} /> : undefined}
        />
      )}
    </div>
  );
}
