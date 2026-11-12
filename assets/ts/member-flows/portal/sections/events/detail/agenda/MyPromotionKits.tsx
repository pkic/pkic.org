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
import { PromotionBadgeTiles } from "./PromotionBadgeTile";
import type { PromotionTileSelection } from "./PromotionTile";
import { promotionFileKey } from "./promotion-file-keys";

/** Picks one file and remembers how to download it, for the dialog's commands on the selection. */
/** The file's download, or undefined while the file is not ready to download. */
export type PromotionFilePicker = (key: string, download?: () => Promise<void>) => PromotionTileSelection;

/** Everything a participant shares for one event: their materials, then their invite link. */
export function MyPromotionKits({
  slug,
  attendeeEligible = false,
  canInvite = false,
  speakerEligible = true,
  share,
  userId,
  pick,
}: {
  slug: string;
  attendeeEligible?: boolean;
  canInvite?: boolean;
  speakerEligible?: boolean;
  share?: SharePanelOptions;
  userId?: string;
  /** Lets an organizer pick files to download or email together. */
  pick?: PromotionFilePicker;
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
  const select =
    pick &&
    ((kit: { occurrenceId: string } | "attendee") => (format: string, download?: () => Promise<void>) =>
      pick(promotionFileKey(kit, format), download));
  const inviteAction = canInvite && !userId ? <InviteColleagueButton eventSlug={slug} /> : undefined;
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
      {sessions.map((session) => {
        const base = promotionResourcePath(
          event,
          `agenda/occurrences/${encodeURIComponent(session.id)}/promotion`,
          target,
        );
        return (
          <PersonalPromotionKit
            key={session.id}
            base={base}
            readOnly={Boolean(userId)}
            title={session.title}
            select={select?.({ occurrenceId: session.id })}
          />
        );
      })}
      {(attendeeEligible || (userId && registered)) && (
        <PersonalPromotionKit
          base={promotionResourcePath(event, "promotion", target)}
          readOnly={Boolean(userId)}
          title="Your attendee materials"
          select={select?.("attendee")}
          leading={badgeUrl && <PromotionBadgeTiles badgeUrl={badgeUrl} />}
        />
      )}
      {share ? (
        <SharePanel options={{ ...share, hideBadge: true }} inviteAction={inviteAction} />
      ) : inviteAction ? (
        <div class="pk-cluster">{inviteAction}</div>
      ) : null}
    </div>
  );
}
