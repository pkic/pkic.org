import type { eventParticipationLink } from "../../shared/event-participation-link";
import { Badge } from "../ui/Badge";
import { ButtonLink } from "../ui/Button";
import { PreferenceStar } from "../ui/PreferenceStar";

/** Interest and registration stay independent on both cards and session details. */
export function AgendaParticipationControls({
  participation,
  title,
  detail = false,
}: {
  participation: ReturnType<typeof eventParticipationLink>;
  title: string;
  detail?: boolean;
}) {
  const favoriteLabel = `${participation.favorite.label} for ${title}`;
  const favoriteTitle = `${participation.favorite.label}. ${participation.favorite.message}`;
  return (
    <>
      <Badge tone="neutral" dot={false}>
        {participation.policyLabel}
      </Badge>
      {detail ? (
        <ButtonLink href={participation.favorite.url} icon aria-label={favoriteLabel} title={favoriteTitle}>
          <PreferenceStar />
        </ButtonLink>
      ) : (
        <a
          class="pk-content-agenda__media-action"
          href={participation.favorite.url}
          aria-label={favoriteLabel}
          title={favoriteTitle}
        >
          <PreferenceStar />
        </a>
      )}
      {!participation.preference &&
        (detail ? (
          <ButtonLink href={participation.url} title={participation.message}>
            {participation.label}
          </ButtonLink>
        ) : (
          <a class="pk-content-agenda__media-action" href={participation.url} title={participation.message}>
            {participation.label}
          </a>
        ))}
    </>
  );
}
