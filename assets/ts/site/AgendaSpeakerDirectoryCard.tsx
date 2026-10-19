import type { ContentAgendaSpeaker } from "../../shared/site-agenda";
import { formatNumber } from "../../shared/format-number";
import { SpeakerPortraitCard } from "../ui/SpeakerPortraitCard";
import { Badge } from "../ui/Badge";
import type { AgendaSpeakerSession } from "./agenda-speaker-sessions";
import { AgendaSpeakerAffiliations, AgendaSpeakerOrganizationLogo } from "./AgendaSpeakerAffiliations";

/** Portrait directory cards open the supplied frozen credit without resolving identity by name. */
export function AgendaSpeakerDirectoryCard({
  speaker,
  profileId,
  sessions,
  buttonProps,
  size,
  footerControls,
}: {
  speaker: ContentAgendaSpeaker;
  profileId?: string;
  footerControls?: Parameters<typeof SpeakerPortraitCard>[0]["footerControls"];
  size?: Parameters<typeof SpeakerPortraitCard>[0]["size"];
  /** A supplied control-room action uses the exact directory card without opening a profile. */
  buttonProps?: Parameters<typeof SpeakerPortraitCard>[0]["buttonProps"];
  sessions?: readonly AgendaSpeakerSession[];
}) {
  const organizations =
    speaker.affiliations?.flatMap(({ organization }) => (organization?.logoSrc ? [organization] : [])) ?? [];
  return (
    <SpeakerPortraitCard
      size={size}
      footerControls={footerControls}
      name={speaker.name}
      imageSrc={speaker.imageSrc}
      buttonProps={
        buttonProps ?? {
          "data-agenda-open-speaker": true,
          "aria-haspopup": "dialog",
          "aria-controls": profileId,
        }
      }
    >
      <span class="pk-agenda-speaker-directory__name">
        <strong title={speaker.name}>{speaker.name}</strong>
        {speaker.moderator ? (
          <Badge tone="warn" dot={false}>
            Moderator
          </Badge>
        ) : null}
        {speaker.roleLabel ? (
          <Badge tone="neutral" dot={false}>
            {speaker.roleLabel}
          </Badge>
        ) : null}
      </span>
      <AgendaSpeakerAffiliations affiliations={speaker.affiliations} layout="directory" size="card" />
      {organizations.length || sessions?.length ? (
        <span class="pk-agenda-speaker-directory__footer">
          {organizations.length ? (
            <span class="pk-agenda-speaker-directory__logos">
              {organizations.map((organization) => (
                <AgendaSpeakerOrganizationLogo organization={organization} size="card" />
              ))}
            </span>
          ) : null}
          {sessions?.length ? (
            <span class="pk-agenda-speaker-directory__link">
              {formatNumber(sessions.length)} {sessions.length === 1 ? "session" : "sessions"}{" "}
              <span aria-hidden="true">→</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </SpeakerPortraitCard>
  );
}
