import type { AgendaSpeakerSession } from "./agenda-speaker-sessions";
import { contractClock, type ClockZone } from "../../shared/event-clock";
import {
  formatClockName,
  formatClockRangeInZone,
  formatDateTime,
  formatEventDayInZone,
} from "../../shared/format-date";
import { Badge } from "../ui/Badge";
import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import type { ContentAgendaDay, ContentAgendaSpeaker } from "../../shared/site-agenda";
import { Avatar } from "../ui/Avatar";
import { CloseButton } from "../ui/CloseButton";
import { LinkList } from "../ui/LinkList";
import { Markdown } from "../ui/Markdown";
import { DeferredImages } from "./SiteImage";
import { AgendaSpeakerAffiliations, AgendaSpeakerLogos } from "./AgendaSpeakerAffiliations";
import { AgendaSessionRow, AgendaSessionRows } from "./AgendaSessionRow";

/**
 * Each speaker's profile is one dialog, rendered once: beside the program for every speaker with
 * a stable reference, and beside its session card for a credit without one. Every card, the
 * session details and the directory open that one dialog, so none is nested in another.
 */
export interface AgendaSpeakerDialogs {
  /** The id of the profile dialog rendered for this credit, if one is. */
  profileId: (speaker: ContentAgendaSpeaker) => string | undefined;
  /** The reader's star for one session in a speaker's list, when that session takes one. */
  star: (occurrenceId: string) => ComponentChildren;
  /** Whether the sessions in a speaker's list open in place, in a rendered agenda (agenda.ts). */
  inAgenda: boolean;
}

export const AgendaSpeakerDialogsContext = createContext<AgendaSpeakerDialogs | null>(null);

type AgendaSessionContent = ContentAgendaDay["slots"][number]["sessions"][number];

/**
 * One profile per speaker with a stable reference, in first-credit order: the directory's credit
 * when the speaker is listed there, otherwise their first session's. A speaker without a reference
 * keeps a dialog beside each credit, since credits are never matched by name.
 */
export function agendaSpeakerDialogs(
  days: readonly ContentAgendaDay[],
  directory: readonly ContentAgendaSpeaker[],
  star: (session: AgendaSessionContent) => ComponentChildren,
): { context: AgendaSpeakerDialogs; profiles: { speaker: ContentAgendaSpeaker; id: string }[] } {
  const credits = new Map<string, ContentAgendaSpeaker>();
  const sessions = new Map<string, AgendaSessionContent>();
  for (const speaker of directory)
    if (speaker.speakerKey && !credits.has(speaker.speakerKey)) credits.set(speaker.speakerKey, speaker);
  for (const day of days)
    for (const slot of day.slots)
      for (const session of slot.sessions) {
        if (session.id && !sessions.has(session.id)) sessions.set(session.id, session);
        for (const speaker of session.speakers)
          if (speaker.speakerKey && !credits.has(speaker.speakerKey)) credits.set(speaker.speakerKey, speaker);
      }
  const ids = new Map([...credits.keys()].map((key, index) => [key, `agenda-speaker-profile-${index}`]));
  return {
    context: {
      profileId: (speaker) => (speaker.speakerKey ? ids.get(speaker.speakerKey) : undefined),
      star: (id) => {
        const session = sessions.get(id);
        return session ? star(session) : null;
      },
      inAgenda: true,
    },
    profiles: [...credits].map(([key, speaker]) => ({ speaker, id: ids.get(key)! })),
  };
}

/** The speaker profile, in the session details' dialog shell: who they are, then their sessions. */
export function AgendaSpeakerProfile({
  speaker,
  profileId,
  sessions,
  timeZone,
}: {
  speaker: ContentAgendaSpeaker;
  profileId: string;
  sessions?: readonly AgendaSpeakerSession[];
  timeZone?: ClockZone;
}) {
  const titleId = `${profileId}-title`;
  return (
    <dialog
      class="pk-agenda-speaker-profile"
      id={profileId}
      aria-labelledby={titleId}
      data-agenda-speaker-dialog
      data-agenda-speaker-key={speaker.speakerKey ?? profileId}
    >
      <DeferredImages>
        <div class="session-modal__header">
          <div class="session-modal__heading">
            <div class="pk-agenda-speaker-profile__identity">
              <span class="pk-agenda-speaker-profile__portrait">
                <Avatar name={speaker.name} src={speaker.imageSrc} size="xl" />
              </span>
              <div class="pk-agenda-speaker-profile__name">
                {/* Opening lands on the name, as the session details land on their title. */}
                <h2 class="session-modal__title" id={titleId} tabIndex={-1} autofocus>
                  {speaker.name}
                </h2>
                {speaker.moderator || speaker.roleLabel ? (
                  <span class="pk-agenda-speaker-profile__roles">
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
                ) : null}
              </div>
            </div>
          </div>
          <div class="session-modal__tools">
            <CloseButton label="Close speaker profile" data-agenda-close-speaker />
          </div>
        </div>
        <div class="session-modal__body">
          {speaker.affiliations?.length || speaker.links?.length ? (
            <div class="pk-agenda-speaker-profile__affiliations">
              <div class="pk-agenda-speaker-profile__affiliation-text">
                <AgendaSpeakerAffiliations affiliations={speaker.affiliations} size="profile" showLogos={false} />
                {speaker.links?.length ? (
                  <LinkList
                    links={speaker.links}
                    ownerName={speaker.name}
                    label={`${speaker.name} elsewhere`}
                    compact
                  />
                ) : null}
              </div>
              <AgendaSpeakerLogos affiliations={speaker.affiliations} size="profile" />
            </div>
          ) : null}
          {speaker.bioMarkdown || speaker.bioHtml ? (
            <section class="session-modal__section">
              <h3>About</h3>
              {speaker.bioMarkdown ? (
                <Markdown markdown={speaker.bioMarkdown} />
              ) : (
                <div dangerouslySetInnerHTML={{ __html: speaker.bioHtml! }} />
              )}
            </section>
          ) : null}
          {sessions?.length ? (
            <AgendaSpeakerSessionList heading="Sessions" sessions={sessions} timeZone={timeZone} />
          ) : null}
          {speaker.personPath ? (
            <p>
              <a href={speaker.personPath}>Full speaker profile</a>
            </p>
          ) : null}
        </div>
      </DeferredImages>
    </dialog>
  );
}

/** A session's clock: its own event's when a list spans events, otherwise the list's. */
function sessionClock(session: AgendaSpeakerSession, timeZone: ClockZone | undefined): ClockZone | undefined {
  return session.timeZone ? contractClock({ ...session, timeZone: session.timeZone }) : timeZone;
}

/**
 * A speaker's sessions with day, times, room and role. The clock is named once for the list;
 * inside an agenda each title opens the session's details and carries the reader's star.
 */
export function AgendaSpeakerSessionList({
  heading,
  headingLevel: Heading = "h3",
  sessions,
  timeZone,
}: {
  heading: ComponentChildren;
  headingLevel?: "h2" | "h3";
  sessions: readonly AgendaSpeakerSession[];
  timeZone?: ClockZone;
}) {
  const dialogs = useContext(AgendaSpeakerDialogsContext);
  const clocks = new Set(
    sessions.map((session) => sessionClock(session, timeZone)).map((zone) => zone && formatClockName(zone)),
  );
  const sharedClock = clocks.size === 1 ? [...clocks][0] : undefined;
  return (
    <section class="session-modal__section pk-agenda-speaker-profile__sessions">
      <Heading>{heading}</Heading>
      <AgendaSessionRows clock={sharedClock}>
        {sessions.map((session) => {
          const zone = sessionClock(session, timeZone);
          return (
            <AgendaSessionRow
              key={session.id}
              dateTime={session.startsAt}
              when={
                zone ? (
                  <>
                    <span>{formatEventDayInZone(session.startsAt, zone)}</span>
                    <span>
                      {formatClockRangeInZone(session.startsAt, session.endsAt, zone)}
                      {sharedClock ? "" : ` ${formatClockName(zone)}`}
                    </span>
                  </>
                ) : (
                  formatDateTime(session.startsAt)
                )
              }
              title={session.title}
              open={{ href: session.url, occurrence: dialogs?.inAgenda ? session.id : undefined }}
              room={session.room}
              details={
                <>
                  {session.moderator ? (
                    <Badge tone="warn" dot={false}>
                      Moderator
                    </Badge>
                  ) : null}
                  {session.roleLabel ? (
                    <Badge tone="neutral" dot={false}>
                      {session.roleLabel}
                    </Badge>
                  ) : null}
                  <AgendaSpeakerAffiliations affiliations={session.affiliations} size="card" />
                </>
              }
              actions={dialogs?.star(session.id)}
            />
          );
        })}
      </AgendaSessionRows>
    </section>
  );
}
