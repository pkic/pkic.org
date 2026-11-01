import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { SharePanel, extractOgBadgeUrl, type SharePanelOptions } from "../../../../../../shared/widgets/share-panel";
import { promotionSessionListSchema } from "../../../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../../../shared/api-client";
import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { PersonalPromotionKit } from "./PersonalPromotionKit";
import { PromotionTile } from "./PromotionTile";

type Session = z.infer<typeof promotionSessionListSchema>["occurrences"][number];

function withQuery(url: string, query: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

/** Everything a participant shares for one event: their materials, then their invite link. */
export function MyPromotionKits({
  slug,
  attendeeEligible = false,
  speakerEligible = true,
  share,
}: {
  slug: string;
  attendeeEligible?: boolean;
  speakerEligible?: boolean;
  share?: SharePanelOptions;
}) {
  const event = `/api/v1/events/${encodeURIComponent(slug)}`;
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    if (!speakerEligible) return;
    void getJson(`${event}/agenda/promotion`, promotionSessionListSchema).then((data) => setSessions(data.occurrences));
  }, [event, speakerEligible]);
  const badgeUrl = share && extractOgBadgeUrl(share.shareUrl, share.badgeVersion);
  return (
    <div class="pk-stack">
      {sessions.map((session) => (
        <PersonalPromotionKit
          key={session.id}
          base={`${event}/agenda/occurrences/${encodeURIComponent(session.id)}/promotion`}
          title={session.title}
        />
      ))}
      {attendeeEligible && (
        <PersonalPromotionKit
          base={`${event}/promotion`}
          title="Your attendee materials"
          leading={
            badgeUrl && (
              <PromotionTile
                name="Badge"
                detail="Wide, square · JPEG"
                previewSrc={withQuery(badgeUrl, "thumbnail=1")}
                previewAlt="Preview of your badge"
                action={
                  <DownloadAction
                    label="Download badge (JPEG)"
                    menuLabel="Download badge formats"
                    options={[
                      {
                        id: "landscape",
                        label: "Wide badge (JPEG)",
                        href: withQuery(badgeUrl, "download=1"),
                      },
                      {
                        id: "square",
                        label: "Square badge (JPEG)",
                        href: withQuery(badgeUrl, "format=square&download=1"),
                      },
                    ]}
                  />
                }
              />
            )
          }
        />
      )}
      {share && <SharePanel options={{ ...share, hideBadge: true }} />}
    </div>
  );
}
