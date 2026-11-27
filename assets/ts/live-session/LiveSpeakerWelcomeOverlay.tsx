import { formatClockInZone } from "../../shared/format-date";
import { liveWelcomedSpeakers } from "../../shared/live-room-credits";
import type { LiveCredit, LiveRoomSession } from "../../shared/schemas/live-session-room";
import { Avatar } from "../ui/Avatar";
import { LiveCreditTitles } from "./LiveCreditTitles";
import "./LiveSpeakerWelcomeOverlay.css";

/**
 * The full-frame welcome card: the event's name, "Please welcome", the
 * speaker's name, title and organization from their identity, then the
 * session's type, start time in the event's zone, and title. One speaker sits
 * beside a large round headshot; two stack, each beside their own, and a
 * panel sits in a grid three across, the moderator last. The session's
 * hosts are not welcomed. It draws no logo: branding is the production's,
 * placed per scene there.
 */
export function LiveSpeakerWelcomeOverlay({
  session,
}: {
  session: Pick<LiveRoomSession, "title" | "startAt" | "timeZone" | "eventName" | "credits" | "sessionType">;
}) {
  const speakers = liveWelcomedSpeakers(session.credits);
  const sessionType = session.sessionType ?? null;
  if (!speakers.length) return null;
  const single = speakers.length === 1;
  const when = formatClockInZone(session.startAt, session.timeZone);
  return (
    <section
      class="pk-live-welcome"
      aria-label="Speaker welcome"
      data-graphic-theme="event"
      data-count={speakers.length}
      data-arrangement={single ? "single" : speakers.length === 2 ? "stack" : "grid"}
    >
      <header class="pk-live-welcome__head">
        {session.eventName ? <p class="pk-live-welcome__event">{session.eventName}</p> : null}
      </header>
      <div class="pk-live-welcome__body">
        <p class="pk-live-welcome__eyebrow">Please welcome</p>
        <ul class="pk-live-welcome__people">
          {speakers.map((speaker, index) => (
            <li class="pk-live-welcome__person" key={speaker.key} data-ring={index % 3}>
              {single ? null : <Headshot speaker={speaker} />}
              <div>
                <SpeakerName name={speaker.name} />
                <Affiliation speaker={speaker} />
                {speaker.moderator ? <p class="pk-live-welcome__role">Moderator</p> : null}
              </div>
            </li>
          ))}
        </ul>
        <span class="pk-live-welcome__rule" />
        <p class="pk-live-welcome__when">{sessionType ? `${sessionType} · ${when}` : when}</p>
        <p class="pk-live-welcome__session">{session.title}</p>
      </div>
      {single ? (
        <div class="pk-live-welcome__portrait" data-ring="0">
          <Headshot speaker={speakers[0]!} />
        </div>
      ) : null}
      <span class="pk-live-welcome__stripe" />
    </section>
  );
}

/** Names up to this many characters set at full size. */
const NAME_FULL = 16;
/** Longer names set smaller; past this, the given name keeps its size and the rest goes under it, smaller. */
const NAME_SPLIT = 22;

/**
 * The name, sized by its length: full size when short, smaller when long,
 * and for a very long name the first word large with the rest on a line of
 * its own, smaller, so the name never breaks mid-word or runs off the frame.
 */
function SpeakerName({ name }: { name: string }) {
  const words = name.trim().split(/\s+/u);
  const length = name.trim().length;
  if (length > NAME_SPLIT && words.length > 1)
    return (
      <p class="pk-live-welcome__name" data-fit="split">
        <span class="pk-live-welcome__given">{words[0]}</span>{" "}
        <span class="pk-live-welcome__family">{words.slice(1).join(" ")}</span>
      </p>
    );
  return (
    <p class="pk-live-welcome__name" data-fit={length > NAME_FULL ? "long" : undefined}>
      {name}
    </p>
  );
}

function Headshot({ speaker }: { speaker: LiveCredit }) {
  return <Avatar class="pk-live-welcome__headshot" name={speaker.name} src={speaker.photoUrl ?? undefined} original />;
}

/** The title on one line and the organization under it, from the identity; a typed line for someone without one. */
function Affiliation({ speaker }: { speaker: LiveCredit }) {
  const { identity } = speaker;
  if (!identity || speaker.additionalIdentities?.length)
    return (
      <p class="pk-live-welcome__title">
        <LiveCreditTitles credit={speaker} />
      </p>
    );
  return (
    <>
      {identity.title ? <p class="pk-live-welcome__title">{identity.title}</p> : null}
      {identity.organization ? <p class="pk-live-welcome__organization">{identity.organization}</p> : null}
    </>
  );
}
