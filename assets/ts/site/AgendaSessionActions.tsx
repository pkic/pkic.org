import type { ContentAgendaDay } from "../../shared/site-agenda";
import { ButtonLink } from "../ui/Button";
import { IconDownload, IconRemote, IconVideo } from "../ui/MediaIcons";
import { AgendaParticipationControls, type AgendaPersonalSession } from "./AgendaParticipationControls";
import { ExternalLink } from "../ui/ExternalLink";

/**
 * Only actual published capabilities or authenticated portal intent become actions. In the session
 * details these are the media actions; participation follows the abstract and speakers.
 */
export function AgendaSessionActions({
  session,
  editor = false,
  detail = false,
  recordingUrl,
  recordingEmbed,
  ownedRecording,
  onlineAccessUrl,
  dialogId,
  openDetails,
  personal,
}: {
  session: ContentAgendaDay["slots"][number]["sessions"][number];
  editor?: boolean;
  detail?: boolean;
  recordingUrl?: string;
  recordingEmbed?: string | null;
  ownedRecording?: string | null;
  onlineAccessUrl?: string;
  dialogId: string;
  openDetails: () => void;
  /** Portal-only viewer marks; public and organizer agendas omit it. */
  personal?: AgendaPersonalSession;
}) {
  if (detail && !(recordingUrl || session.youtube || session.presentationUrl || onlineAccessUrl)) return null;
  if (detail)
    return (
      <>
        <div class="session-modal__actions">
          {(recordingUrl || session.youtube) && (
            <ButtonLink
              href={recordingUrl ?? `https://www.youtube.com/watch?v=${encodeURIComponent(session.youtube ?? "")}`}
              external
              data-agenda-media-recording={session.recordingApproved || session.youtube ? "" : undefined}
            >
              Watch recording
            </ButtonLink>
          )}
          {session.presentationUrl ? (
            <ButtonLink
              href={session.presentationUrl}
              data-legacy-download-url={session.legacyPresentationUrl}
              variant="primary"
              download
            >
              Download Slides
            </ButtonLink>
          ) : null}
          {onlineAccessUrl && (
            <ButtonLink href={onlineAccessUrl} data-agenda-media-during hidden>
              <IconRemote />
              Join online
            </ButtonLink>
          )}
        </div>
      </>
    );
  return (
    <>
      {session.youtube ||
      recordingUrl ||
      session.presentationUrl ||
      onlineAccessUrl ||
      (!editor && session.participation) ? (
        <div class="pk-content-agenda__actions">
          {!editor && session.participation && (
            <AgendaParticipationControls
              participation={session.participation}
              title={session.title}
              personal={personal}
              dialogId={dialogId}
            />
          )}
          {onlineAccessUrl && (
            <a
              class="pk-content-agenda__media-action"
              href={onlineAccessUrl}
              aria-label="Join online"
              title="Join online"
              data-agenda-media-during
              hidden
            >
              <IconRemote />
              <span class="pk-sr-only">Join online</span>
            </a>
          )}
          {recordingEmbed || ownedRecording ? (
            <a
              href={recordingUrl ?? `https://www.youtube.com/watch?v=${encodeURIComponent(session.youtube ?? "")}`}
              class="pk-content-agenda__media-action pk-content-agenda__recording-action"
              data-agenda-open-session={dialogId}
              aria-label="Watch recording"
              title="Watch recording"
              data-agenda-watch-recording
              data-agenda-media-recording
              onClick={
                editor
                  ? (event) => {
                      event.preventDefault();
                      openDetails();
                    }
                  : undefined
              }
            >
              <IconVideo />
              <span>Recording</span>
            </a>
          ) : null}
          {!recordingEmbed && !ownedRecording && recordingUrl && (
            <ExternalLink
              class="pk-content-agenda__media-action"
              href={recordingUrl}
              external
              aria-label="Watch recording"
              title="Watch recording"
              data-agenda-media-recording={session.recordingApproved || session.youtube ? "" : undefined}
            >
              <IconVideo />
              <span>Recording</span>
            </ExternalLink>
          )}
          {session.presentationUrl ? (
            <a
              class="pk-content-agenda__media-action"
              href={session.presentationUrl}
              data-legacy-download-url={session.legacyPresentationUrl}
              aria-label="Download slides"
              title="Download slides"
              download
            >
              <IconDownload />
              <span class="pk-sr-only">Download slides</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
