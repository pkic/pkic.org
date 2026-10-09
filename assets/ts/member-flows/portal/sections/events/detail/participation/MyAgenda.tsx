import { useHashLocation } from "wouter/use-hash-location";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { databaseIdSchema } from "../../../../../../../shared/schemas/identifiers";
import {
  personalAgendaProgramResponseSchema,
  type personalAgendaMarkSchema,
  type personalAgendaSessionSchema,
} from "../../../../../../../shared/schemas/event-personal-agenda";
import {
  sessionParticipationResponseSchema,
  type sessionParticipationRequestSchema,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { agendaContent } from "../../../../../../../shared/public-agenda-content";
import { getJson, putJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { ContentAgenda } from "../../../../../../site/ContentAgenda";
import type { AgendaPersonalSession } from "../../../../../../site/AgendaParticipationControls";
import { AGENDA_CALENDAR_TITLE, AgendaCalendarSettings } from "./AgendaCalendarSettings";
import { SessionParticipation, SessionParticipationManager } from "./SessionParticipation";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Panel, PanelBody } from "../../../../../../ui/Panel";
import { ButtonLink } from "../../../../../../ui/Button";
import { IconCalendar } from "../../../../../../ui/MediaIcons";
import { usePortalHashLocation } from "../../../../hash-location";
import { toast } from "../../../../ui";

type Mark = z.infer<typeof personalAgendaMarkSchema>;
type LiveSession = z.infer<typeof personalAgendaSessionSchema>;
const REVISED_NOTICE =
  "This session changed after you opened it. Review its updated details, then confirm your choice again.";
type ParticipationStatus = z.infer<typeof sessionParticipationResponseSchema>["status"] | null;

/** Only starred or registered sessions are on the viewer's agenda; canceled rows are not. */
function markOf(id: string, saved: boolean, status: ParticipationStatus): Mark | undefined {
  const booked = status === "reserved" || status === "approval_pending" || status === "waitlisted" ? status : null;
  return saved || booked ? { id, saved, status: booked } : undefined;
}

/**
 * The event app's agenda: the published programme with the reader's own
 * layer. `mine` opens it with the My agenda filter on — the same view, so the
 * Agenda and My agenda tabs differ only in that preset.
 */
export function MyAgenda({
  slug,
  eventId,
  eventName,
  mine = false,
}: {
  slug: string;
  eventId?: string;
  eventName?: string;
  mine?: boolean;
}) {
  const [rawLocation, navigate] = useHashLocation();
  const path = rawLocation.split("?", 1)[0];
  const query = new URLSearchParams(rawLocation.split("?", 2)[1] ?? "");
  const focus = databaseIdSchema.safeParse(query.get("session"));
  const destination = (values: { view?: string }) => {
    const next = new URLSearchParams(query);
    next.delete("session");
    next.delete("view");
    if (values.view) next.set("view", values.view);
    return path + (next.size ? `?${next}` : "");
  };
  if (query.get("view") === "calendar") return <AgendaCalendarSettings slug={slug} eventName={eventName} />;
  return (
    <PersonalAgenda
      slug={slug}
      eventId={eventId}
      focus={focus.success ? focus.data : undefined}
      mine={mine}
      calendarHref={usePortalHashLocation.hrefs(destination({ view: "calendar" }))}
      onFocusClosed={() => navigate(destination({}), { replace: true })}
    />
  );
}

/** The published agenda, shared with the public site and organizer editor, with the viewer's own marks. */
function PersonalAgenda({
  slug,
  eventId,
  focus,
  mine,
  calendarHref,
  onFocusClosed,
}: {
  slug: string;
  eventId?: string;
  focus?: string;
  mine: boolean;
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
    () => (snapshot ? agendaContent(snapshot, false, { participant: true }) : undefined),
    [snapshot],
  );
  const agendaIds = useMemo(
    () =>
      new Set(
        content?.days.flatMap((day) =>
          day.slots.flatMap((slot) => slot.sessions.flatMap((session) => (session.id ? [session.id] : []))),
        ),
      ),
    [content],
  );
  // Marks start from each program read and then follow the viewer's in-place changes.
  const loadedMarks = useMemo(
    () => new Map(program.data?.marks.map((mark) => [mark.id, mark])) as ReadonlyMap<string, Mark>,
    [program.data],
  );
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
  // A live participation read can see a newer approved publication than the programme on screen.
  const [revised, setRevised] = useState<string | null>(null);
  const publishedRevision = snapshot?.publishedRevision ?? null;
  const reloadProgram = program.reload;
  function sessionChanged(session: LiveSession) {
    remember(session.id, session.saved, session.status);
    if (publishedRevision === null || session.publishedRevision <= publishedRevision) return;
    // Reread the programme so the open details show the session the reader is now confirming.
    setRevised(session.id);
    void reloadProgram();
  }
  const [starring, setStarring] = useState<ReadonlySet<string>>(new Set());
  async function star(id: string) {
    if (starring.has(id)) return;
    const saved = Boolean(marks.get(id)?.saved);
    setStarring((current) => new Set(current).add(id));
    try {
      const body: z.input<typeof sessionParticipationRequestSchema> = {
        action: saved ? "unsave" : "save",
        attendanceMode: "physical",
      };
      const result = await putJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/${encodeURIComponent(id)}/participation`,
        body,
        sessionParticipationResponseSchema,
      );
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
  // Session details are opened by the shared agenda's own controls; live management loads only for the open one.
  const host = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
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
    // A refreshed programme remounts moved cards and reopens the focused or revised session, so a
    // dialog missing right after a content change is not a close.
    if (root.querySelector("dialog.session-modal[open]")) sync();
    return () => observer.disconnect();
  }, [content]);
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
  if (focus && !agendaIds.has(focus))
    return <SessionParticipation key={focus} slug={slug} eventId={eventId} occurrenceId={focus} />;
  const personal = {
    // A focused session opens over the whole programme, where it is never filtered away.
    mineFilter: mine && !focus,
    session: (id: string): AgendaPersonalSession => {
      const mark = marks.get(id);
      return {
        starred: Boolean(mark?.saved),
        status: mark?.status ?? undefined,
        busy: starring.has(id),
        onStar: () => void star(id),
        detail:
          openId === id ? (
            <SessionParticipationManager
              slug={slug}
              eventId={eventId}
              occurrenceId={id}
              refreshKey={`${mark?.saved ?? false}:${mark?.status ?? ""}`}
              notice={revised === id ? REVISED_NOTICE : undefined}
              onChanged={sessionChanged}
            />
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
  return (
    <div class="pk-stack" ref={host}>
      {program.error && <ErrorAlert error={program.error} />}
      {content && snapshot && content.days.length ? (
        <ContentAgenda
          days={content.days}
          speakers={content.speakers}
          timeZone={snapshot.timeZone}
          legacySpeakerFragments={content.legacySpeakerFragments}
          personal={personal}
          openOccurrence={focus ?? revised ?? undefined}
        />
      ) : (
        <Panel>
          <PanelBody>
            <p>{snapshot ? "No public sessions are scheduled yet." : "The agenda has not been published yet."}</p>
            <ButtonLink href={calendarHref}>{AGENDA_CALENDAR_TITLE}</ButtonLink>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
