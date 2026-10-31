import { splitHash, subscribeHashQuery, hashQuerySnapshot, writeHashQuery } from "../../../../../../ui/url-query";
import { contractClock } from "../../../../../../../shared/event-clock";
import { useSyncExternalStore } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { databaseIdSchema } from "../../../../../../../shared/schemas/identifiers";
import {
  personalAgendaProgramResponseSchema,
  type personalAgendaMarkSchema,
  type personalAgendaSessionSchema,
} from "../../../../../../../shared/schemas/event-personal-agenda";
import type { sessionParticipationResponseSchema } from "../../../../../../../shared/schemas/event-participation-scanning";
import { agendaContent } from "../../../../../../../shared/public-agenda-content";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { ContentAgenda } from "../../../../../../site/ContentAgenda";
import type { AgendaPersonalSession } from "../../../../../../site/AgendaParticipationControls";
import { AGENDA_CALENDAR_TITLE, AgendaCalendarSettings } from "./AgendaCalendarSettings";
import { SessionCheckInLink, SessionParticipation, SessionParticipationManager } from "./SessionParticipation";
import { setSessionStar } from "./session-star";
import { SessionQuestions } from "../../../../../../live-session/SessionQuestions";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { Panel, PanelBody } from "../../../../../../ui/Panel";
import {
  eventAgendaRoute,
  eventSessionRoute,
  sessionSeatAction,
} from "../../../../../../../shared/event-participation-link";
import { MyAgendaList } from "./MyAgendaList";
import { ButtonLink } from "../../../../../../ui/Button";
import { IconCalendar } from "../../../../../../ui/MediaIcons";
import { usePortalHashLocation } from "../../../../hash-location";
import { toast } from "../../../../ui";

type Mark = z.infer<typeof personalAgendaMarkSchema>;
type LiveSession = z.infer<typeof personalAgendaSessionSchema>;
const REVISED_NOTICE =
  "This session changed after you opened it. Review its updated details, then confirm your choice again.";
type ParticipationStatus = z.infer<typeof sessionParticipationResponseSchema>["status"] | null;

/** Starred sessions and held places are on the viewer's agenda; a released seat stays while it is starred. */
function markOf(id: string, saved: boolean, status: ParticipationStatus): Mark | undefined {
  const booked = status === "reserved" || status === "approval_pending" || status === "waitlisted" ? status : null;
  return saved || booked ? { id, saved, status: status === "canceled" ? status : booked } : undefined;
}

/**
 * The event app's agenda: the published program with the reader's own
 * layer. `mine` lists only the reader's own sessions, compactly per day; a
 * session opened from there shows its details over the whole program.
 */
export function MyAgenda({
  slug,
  eventId,
  eventName,
  mine = false,
  canPersonalize = false,
}: {
  slug: string;
  eventId?: string;
  eventName?: string;
  mine?: boolean;
  canPersonalize?: boolean;
}) {
  const rawLocation = useSyncExternalStore(subscribeHashQuery, hashQuerySnapshot);
  const { path, params: query } = splitHash(rawLocation);
  const focus = databaseIdSchema.safeParse(query.get("session"));
  const destination = (values: { view?: string }) => {
    const next = splitHash().params;
    next.delete("session");
    next.delete("view");
    if (values.view) next.set("view", values.view);
    return path + (next.size ? `?${next}` : "");
  };
  if (!canPersonalize && (mine || query.get("view") === "calendar"))
    return (
      <EmptyState
        title="Register to create your agenda"
        body="After registering for this event, you can save sessions and build your own schedule."
      >
        <ButtonLink href={usePortalHashLocation.hrefs(`/events/${encodeURIComponent(slug)}`)}>View event</ButtonLink>
      </EmptyState>
    );
  if (query.get("view") === "calendar") return <AgendaCalendarSettings slug={slug} eventName={eventName} />;
  return (
    <PersonalAgenda
      slug={slug}
      eventId={eventId}
      focus={focus.success ? focus.data : undefined}
      mine={mine}
      canPersonalize={canPersonalize}
      calendarHref={usePortalHashLocation.hrefs(destination({ view: "calendar" }))}
      onFocusClosed={() => {
        const current = splitHash();
        const next = new URLSearchParams(current.params);
        next.delete("session");
        writeHashQuery(path, next);
      }}
    />
  );
}

/** The published agenda, shared with the public site and organizer editor, with the viewer's own marks. */
function PersonalAgenda({
  slug,
  eventId,
  focus,
  mine,
  canPersonalize,
  calendarHref,
  onFocusClosed,
}: {
  slug: string;
  eventId?: string;
  focus?: string;
  mine: boolean;
  canPersonalize: boolean;
  calendarHref: string;
  onFocusClosed: () => void;
}) {
  const program = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation/program`,
        personalAgendaProgramResponseSchema,
      ),
    [slug],
  );
  const snapshot = program.data?.agenda;
  // The server scoped private sessions to the ones this reader is invited to or booked on.
  const content = useMemo(
    () =>
      snapshot ? agendaContent(snapshot, false, { participant: true, personalAgenda: canPersonalize }) : undefined,
    [snapshot, canPersonalize],
  );
  // Each listed session's scheduled window, for its live questions while it runs.
  const agendaSessions = useMemo(
    () =>
      new Map(
        content?.days.flatMap((day) =>
          day.slots.flatMap((slot) =>
            slot.sessions.flatMap((session) =>
              session.id ? [[session.id, { startAt: slot.startsAt, endAt: session.endsAt }] as const] : [],
            ),
          ),
        ),
      ),
    [content],
  );
  // Marks start from each program read and then follow the viewer's in-place changes.
  const loadedMarks = useMemo(
    () => new Map(program.data?.marks.map((mark) => [mark.id, mark])) as ReadonlyMap<string, Mark>,
    [program.data],
  );
  // Each scheduled session's seat action for this viewer, named by the rule the session details use.
  const seatActions = useMemo(() => {
    const policies = new Map(snapshot?.occurrences.map((occurrence) => [occurrence.id, occurrence.admissionPolicy]));
    const actions = new Map<string, string>();
    for (const entry of program.data?.availability ?? []) {
      const admissionPolicy = policies.get(entry.id);
      const seat = admissionPolicy && sessionSeatAction({ admissionPolicy, availability: entry.availability });
      if (seat) actions.set(entry.id, seat.label);
    }
    return actions;
  }, [program.data, snapshot]);
  const [changed, setChanged] = useState({ source: loadedMarks, marks: loadedMarks });
  const marks = changed.source === loadedMarks ? changed.marks : loadedMarks;
  const remember = (id: string, saved: boolean, status: ParticipationStatus) =>
    setChanged((current) => {
      const next = new Map(current.source === loadedMarks ? current.marks : loadedMarks);
      const mark = markOf(id, saved, status);
      if (mark) next.set(id, mark);
      else next.delete(id);
      return { source: loadedMarks, marks: next };
    });
  // A live participation read can see a newer approved publication than the program on screen.
  const [revised, setRevised] = useState<string | null>(null);
  const publishedRevision = snapshot?.publishedRevision ?? null;
  const reloadProgram = program.reload;
  function sessionChanged(session: LiveSession) {
    remember(session.id, session.saved, session.status);
    if (publishedRevision === null || session.publishedRevision <= publishedRevision) return;
    // Reread the program so the open details show the session the reader is now confirming.
    setRevised(session.id);
    void reloadProgram();
  }
  const [starring, setStarring] = useState<ReadonlySet<string>>(new Set());
  async function star(id: string) {
    if (starring.has(id)) return;
    const saved = Boolean(marks.get(id)?.saved);
    setStarring((current) => new Set(current).add(id));
    try {
      const result = await setSessionStar(slug, id, !saved);
      remember(id, !saved, result.status);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Your star could not be updated. Please try again.", "error");
    } finally {
      setStarring((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }
  // A focused session opens over the whole program, where it is never filtered away.
  const mineOnly = mine && !focus;
  // My agenda with nothing on it shows a way to the agenda instead of the agenda itself.
  const nothingSaved = Boolean(
    mineOnly &&
    content?.days.length &&
    ![...marks.values()].some(
      (mark) => (mark.saved || (mark.status && mark.status !== "canceled")) && agendaSessions.has(mark.id),
    ),
  );
  // Session details are opened by the shared agenda's own controls; live management loads only for the open one.
  const host = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Watched again whenever the agenda is (re)mounted: after an empty My agenda, the whole program mounts it anew.
  useEffect(() => {
    const root = host.current?.querySelector<HTMLElement>(".pk-content-agenda");
    if (!root) return;
    const sync = () =>
      setOpenId(
        root.querySelector("dialog.session-modal[open]")?.closest<HTMLElement>("[data-agenda-occurrence]")?.dataset
          .agendaOccurrence ?? null,
      );
    const observer = new MutationObserver(sync);
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["open"] });
    // A refreshed program remounts moved cards and reopens the focused or revised session, so a
    // dialog missing right after a content change is not a close.
    if (root.querySelector("dialog.session-modal[open]")) sync();
    return () => observer.disconnect();
  }, [content, nothingSaved, program.loading, mineOnly]);
  useEffect(() => {
    if (openId !== revised) setRevised(null);
  }, [openId]);
  const previousOpen = useRef<string | null>(null);
  const focusClosed = useRef(onFocusClosed);
  focusClosed.current = onFocusClosed;
  useEffect(() => {
    if (previousOpen.current && !openId && previousOpen.current === focus) focusClosed.current();
    previousOpen.current = openId;
  }, [openId, focus]);
  if (program.loading) return <Spinner label="Loading your agenda…" />;
  if (program.error && !program.data) return <ErrorAlert error={program.error} />;
  // A deep link to a session outside the shared agenda (for example invitation-only) keeps its dedicated view.
  if (focus && !agendaSessions.has(focus))
    return <SessionParticipation key={focus} slug={slug} eventId={eventId} occurrenceId={focus} />;
  if (nothingSaved)
    return (
      <EmptyState title="No saved sessions yet" body="Star sessions on the agenda to build your own schedule.">
        <ButtonLink variant="secondary" href={usePortalHashLocation.hrefs(eventAgendaRoute(slug))}>
          Browse the agenda
        </ButtonLink>
      </EmptyState>
    );
  const personal = {
    mineOnly,
    session: (id: string): AgendaPersonalSession => {
      const mark = marks.get(id);
      const scheduled = agendaSessions.get(id);
      return {
        starred: Boolean(mark?.saved),
        status: mark?.status ?? undefined,
        busy: starring.has(id),
        onStar: () => void star(id),
        seatAction: seatActions.get(id),
        headerActions: <SessionCheckInLink slug={slug} eventId={eventId} occurrenceId={id} />,
        detail:
          openId === id ? (
            <>
              <SessionParticipationManager
                slug={slug}
                occurrenceId={id}
                refreshKey={`${mark?.saved ?? false}:${mark?.status ?? ""}`}
                notice={revised === id ? REVISED_NOTICE : undefined}
                onChanged={sessionChanged}
              />
              {scheduled?.endAt ? (
                <SessionQuestions slug={slug} occurrenceId={id} startAt={scheduled.startAt} endAt={scheduled.endAt} />
              ) : null}
            </>
          ) : undefined,
      };
    },
    toolbarControls: (
      <ButtonLink
        icon
        variant="secondary"
        href={calendarHref}
        aria-label={AGENDA_CALENDAR_TITLE}
        title={AGENDA_CALENDAR_TITLE}
      >
        <IconCalendar />
      </ButtonLink>
    ),
  };
  if (mineOnly && content && snapshot)
    return (
      <div class="pk-stack">
        {program.error && <ErrorAlert error={program.error} />}
        <div class="pk-cluster">
          <ButtonLink variant="secondary" href={calendarHref}>
            <IconCalendar />
            <span>{AGENDA_CALENDAR_TITLE}</span>
          </ButtonLink>
        </div>
        <MyAgendaList
          days={content.days}
          clock={contractClock(snapshot)}
          session={personal.session}
          sessionHref={(id) => usePortalHashLocation.hrefs(eventSessionRoute(slug, id, { mine: true }))}
        />
      </div>
    );
  return (
    <div class="pk-stack" ref={host}>
      {program.error && <ErrorAlert error={program.error} />}
      {content && snapshot && content.days.length ? (
        <ContentAgenda
          days={content.days}
          speakers={content.speakers}
          timeZone={contractClock(snapshot)}
          legacySpeakerFragments={content.legacySpeakerFragments}
          personal={canPersonalize ? personal : undefined}
          openOccurrence={focus ?? revised ?? undefined}
        />
      ) : (
        <Panel>
          <PanelBody>
            <p>{snapshot ? "No public sessions are scheduled yet." : "The agenda has not been published yet."}</p>
            {canPersonalize && <ButtonLink href={calendarHref}>{AGENDA_CALENDAR_TITLE}</ButtonLink>}
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
