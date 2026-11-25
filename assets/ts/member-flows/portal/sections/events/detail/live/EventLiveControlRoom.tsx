import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import { useLiveRoomProgram } from "../../../../../../live-session/useLiveRoomProgram";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { IconChevron } from "../../../../../../ui/MediaIcons";
import { splitHash, writeUrlQuery } from "../../../../../../ui/url-query";
import { useBoundaryClock } from "../../../../../../hooks/useBoundaryClock";
import type { ComponentChildren } from "preact";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { personalAgendaProgramResponseSchema } from "../../../../../../../shared/schemas/event-personal-agenda";
import { getJson } from "../../../../../../shared/api-client";
import { contractClock, type ClockZone } from "../../../../../../../shared/event-clock";
import { formatClockName } from "../../../../../../../shared/format-date";
import { useData } from "../../../../../../hooks/useData";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { usePortalHashLocation } from "../../../../hash-location";
import { defaultLiveSession, liveSessionDays, liveRoomChoices, type LiveSessionChoice } from "./live-session-choices";
import { liveAgendaDrift, liveAgendaDriftText } from "../../../../../../../shared/live-session-agenda";
import type { StudioNoticeContent } from "./studio/StudioHeader";
import { LiveSessionDesk } from "./LiveSessionDesk";
import "./LiveSessionDesk.css";

export function SelectedSessionDesk({
  slug,
  occurrenceId,
  roomId,
  approvedAgenda,
  roomControl,
  clock,
  sessions = [],
  agendaSession,
  onBrowse,
  eventPath,
  canProduce = true,
  canSetUp = false,
}: {
  /** The event's own page, which the phone studio links back to. */
  eventPath?: string;
  /** Whether this operator runs the studio, or only moderates beside it. */
  canProduce?: boolean;
  /** Whether this operator sets up the live studio for the event. */
  canSetUp?: boolean;
  slug: string;
  occurrenceId: string;
  roomId: string;
  approvedAgenda?: AgendaSnapshot;
  roomControl?: ComponentChildren;
  clock?: ClockZone;
  /** The room's sessions on the approved agenda, to compare the active one with. */
  sessions?: readonly LiveSessionChoice[];
  /** The session the agenda has now in this room, or next between sessions. */
  agendaSession?: LiveSessionChoice;
  /** Browses to a session without making it active. */
  onBrowse?: (occurrenceId: string) => void;
}) {
  const program = useLiveRoomProgram({ slug, roomId });
  const [failure, setFailure] = useState<string | null>(null);
  // A refusal belongs to the session it happened in.
  useEffect(() => setFailure(null), [occurrenceId]);
  // A dropped connection keeps the last session on air: the header still reads Loaded and the
  // monitors hold their picture while it reconnects, and the desk pauses the controls meanwhile.
  const activeId = program.selection?.occurrenceId ?? null;
  const active = activeId === occurrenceId;
  const now = useBoundaryClock(useCallback((at: number) => at + 30_000, []));
  const activeSession = sessions.find((choice) => choice.id === activeId) ?? null;
  const drift = liveAgendaDrift(
    activeSession ? { startAt: activeSession.startsAt, endAt: activeSession.endsAt } : null,
    agendaSession ? { startAt: agendaSession.startsAt, endAt: agendaSession.endsAt, title: agendaSession.title } : null,
    now,
    activeSession !== null && activeSession.id === agendaSession?.id,
  );
  const broadcast = async (_message: LiveRoomClientMessage, send: () => boolean): Promise<boolean> => {
    setFailure(null);
    try {
      if (!active && !canProduce) throw new Error("The studio has not loaded this session yet.");
      if (!active) await program.select(occurrenceId);
      if (!send()) throw new Error("The session is reconnecting. Try again when it is connected.");
      return true;
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not update the live program.");
      return false;
    }
  };
  const problem = failure || program.error;
  // An early start reads from the session's own timing in the bar; only drift from a running agenda needs words.
  const agendaNotice: StudioNoticeContent | null = problem
    ? { tone: "danger", text: problem instanceof Error ? problem.message : problem }
    : drift && drift.kind !== "early"
      ? {
          tone: "warn",
          text: liveAgendaDriftText(drift),
          action:
            agendaSession && agendaSession.id !== occurrenceId && onBrowse ? (
              <Button onClick={() => onBrowse(agendaSession.id)}>Go to agenda session</Button>
            ) : undefined,
        }
      : null;
  // The panels open on the graphics already on air, so they wait for the room to say what that is:
  // a studio reloaded mid-show then lights what is on Program instead of offering to replace it.
  if (program.status === "connecting" && !program.selection) return <Spinner label="Joining the live room…" />;
  return (
    <div class="pk-stack pk-stack--snug" data-density="compact">
      <LiveSessionDesk
        agendaNotice={agendaNotice}
        sessionStatus={
          <span role="status">
            {active ? (
              <span class="pk-studio-header__active">Loaded</span>
            ) : !canProduce ? (
              <span title={"Not loaded\nThe studio loads a session into the room. You can moderate it meanwhile."}>
                Not loaded
              </span>
            ) : (
              <Button
                disabled={program.status !== "live"}
                aria-pressed={active}
                title={
                  "Load session\nLoad this session into the studio and Preview. Program does not change until you transition."
                }
                onClick={() => {
                  setFailure(null);
                  void program
                    .select(occurrenceId)
                    .catch((cause) =>
                      setFailure(cause instanceof Error ? cause.message : "Could not load this session."),
                    );
                }}
              >
                Load session
              </Button>
            )}
          </span>
        }
        slug={slug}
        occurrenceId={occurrenceId}
        roomId={roomId}
        approvedAgenda={approvedAgenda}
        roomControl={roomControl}
        clock={clock}
        broadcast={broadcast}
        activeOccurrenceId={activeId}
        eventPath={eventPath}
        canProduce={canProduce}
        canSetUp={canSetUp}
      />
    </div>
  );
}

/**
 * The event's live control room: pick one scheduled session of the approved
 * agenda, then operate its room. It opens on the session on now, or next, in
 * the operator's room. Several operators may open the same session at once,
 * remote or onsite; the room keeps them in step.
 */
export function EventLiveControlRoom({
  slug,
  occurrenceId,
  sessionPath,
  eventPath,
  renderSession,
  canProduce = true,
  canSetUp = false,
}: {
  /** Whether this operator runs the studio, or only moderates beside it. */
  canProduce?: boolean;
  /** Whether this operator sets up the live studio for the event. */
  canSetUp?: boolean;
  slug: string;
  /** The URL-addressed session, if one is selected. */
  occurrenceId?: string;
  sessionPath: (occurrenceId: string) => string;
  /** The event's own page, which the control room links back to. */
  eventPath?: string;
  renderSession?: (occurrenceId: string, roomId: string) => ComponentChildren;
}) {
  const [ownerPath] = usePortalHashLocation();
  const [choosing, setChoosing] = useState(false);
  const [draftRoom, setDraftRoom] = useState("");
  const [draftSession, setDraftSession] = useState("");
  const [roomQuery] = useHashQueryParam("room", "");
  const program = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation/program`,
        personalAgendaProgramResponseSchema,
      ),
    [slug],
  );
  const reloadProgram = program.reload;
  useEffect(() => {
    const refresh = setInterval(() => {
      if (!document.hidden) void reloadProgram();
    }, 30000);
    return () => clearInterval(refresh);
  }, [reloadProgram]);
  const snapshot = program.data?.agenda;
  const days = useMemo(() => (snapshot ? liveSessionDays(snapshot) : []), [snapshot]);
  const selected = days.flatMap((day) => day.choices).find((choice) => choice.id === occurrenceId);
  const rooms = snapshot?.rooms ?? [];
  const roomId = rooms.find((room) => room.id === roomQuery)?.id ?? selected?.roomId ?? rooms[0]?.id ?? "";
  const now = useBoundaryClock(
    useCallback(
      (at: number) => {
        const boundaries = days.flatMap((day) =>
          day.choices.flatMap((choice) => [Date.parse(choice.startsAt), Date.parse(choice.endsAt)]),
        );
        return boundaries.filter((value) => value > at).sort((left, right) => left - right)[0] ?? null;
      },
      [days],
    ),
  );
  const roomGroups = liveRoomChoices(days, roomId, now);
  const choose = useCallback(
    (id: string, selectedRoom = roomId, mode: "push" | "replace" = "push") => {
      const [path, query] = sessionPath(id).split("?", 2);
      const params = splitHash().params;
      new URLSearchParams(query).forEach((value, key) => params.set(key, value));
      if (selectedRoom) params.set("room", selectedRoom);
      writeUrlQuery({ source: "hash", ownerPath, destinationPath: path, params, mode });
    },
    [ownerPath, roomId, sessionPath],
  );
  const ordered = days.flatMap((day) => day.choices).filter((choice) => choice.roomIds.includes(roomId));
  const index = ordered.findIndex((choice) => choice.id === occurrenceId);
  const previous = index > 0 ? ordered[index - 1] : undefined;
  const next = index >= 0 ? ordered[index + 1] : undefined;
  const draftGroups = liveRoomChoices(days, draftRoom, now);
  const fallbackId = occurrenceId
    ? undefined
    : (defaultLiveSession(days, now, roomId) ?? roomGroups[0]?.choices[0])?.id;
  useEffect(() => {
    if (fallbackId) choose(fallbackId, roomId, "replace");
  }, [fallbackId, choose, roomId]);
  if (program.loading) return <Spinner label="Loading the approved agenda…" />;
  if (program.error && !program.data) return <ErrorAlert error={program.error} />;
  if (!days.length)
    return (
      <EmptyState title="No scheduled sessions" body="Sessions appear here once the agenda is approved with times." />
    );
  const roomName = rooms.find((room) => room.id === roomId)?.name ?? "Room";
  const agendaNow = defaultLiveSession(days, Date.now(), roomId);
  const roomControl = (
    <div class="pk-studio-room">
      {eventPath ? (
        <ButtonLink
          icon
          variant="ghost"
          class="pk-studio-room__browse"
          href={`#${eventPath}`}
          aria-label="Back to the event"
          title={"Back to the event\nLeave the studio. Nothing on air changes."}
        >
          <IconChevron pointing="left" />
        </ButtonLink>
      ) : null}
      <Button
        title={`Room: ${roomName}\nChoose another room or session to open in the studio.`}
        onClick={() => {
          setDraftRoom(roomId);
          setDraftSession(selected?.id ?? "");
          setChoosing(true);
        }}
      >
        <span class="pk-studio-room__name">{roomName}</span>
        <span aria-hidden="true"> ▾</span>
      </Button>
      <Button
        icon
        variant="ghost"
        class="pk-studio-room__browse"
        aria-label="Previous session"
        title={"Previous session\nOpen the session before this one in this room. Nothing on air changes."}
        disabled={!previous}
        onClick={() => previous && choose(previous.id)}
      >
        <IconChevron pointing="left" />
      </Button>
      <Button
        variant="ghost"
        class="pk-studio-room__browse"
        title={
          "Session on the agenda now\nOpen the session the agenda has now in this room, or the next one. Nothing on air changes."
        }
        disabled={!agendaNow || agendaNow.id === selected?.id}
        onClick={() => agendaNow && choose(agendaNow.id)}
      >
        Now
      </Button>
      <Button
        icon
        variant="ghost"
        class="pk-studio-room__browse"
        aria-label="Next session"
        title={"Next session\nOpen the session after this one in this room. Nothing on air changes."}
        disabled={!next}
        onClick={() => next && choose(next.id)}
      >
        <IconChevron pointing="right" />
      </Button>
    </div>
  );
  const clock = snapshot ? contractClock(snapshot) : undefined;
  return (
    <div class="pk-live-control-wall" data-density="compact">
      {choosing ? (
        <Dialog
          open
          title="Choose room and session"
          confirmLabel="Open session"
          confirmDisabled={!draftSession}
          onConfirm={() => {
            if (draftSession) {
              choose(draftSession, draftRoom);
              setChoosing(false);
            }
          }}
          onCancel={() => setChoosing(false)}
        >
          <div class="pk-stack">
            <Field label="Room">
              {(control) => (
                <Select
                  {...control}
                  value={draftRoom}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraftRoom(value);
                    setDraftSession(liveRoomChoices(days, value, now)[0]?.choices[0]?.id ?? "");
                  }}
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={snapshot ? `Session (${formatClockName(contractClock(snapshot))})` : "Session"}>
              {(control) => (
                <Select
                  {...control}
                  name="occurrenceId"
                  value={draftSession}
                  onChange={(event) => setDraftSession(event.currentTarget.value)}
                >
                  <option value="">Choose a session in this room</option>
                  {draftGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.choices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Dialog>
      ) : null}
      {selected && renderSession ? (
        <>
          {roomControl}
          {renderSession(selected.id, roomId)}
        </>
      ) : selected ? (
        // One studio for the room: moving to another session keeps its frame, controls and connection to the
        // room's program, and the desk holds the last session's picture until the next one's room answers.
        <SelectedSessionDesk
          slug={slug}
          occurrenceId={selected.id}
          roomId={roomId}
          approvedAgenda={snapshot ?? undefined}
          roomControl={roomControl}
          clock={clock}
          sessions={ordered}
          agendaSession={agendaNow}
          onBrowse={(id) => choose(id)}
          eventPath={eventPath}
          canProduce={canProduce}
          canSetUp={canSetUp}
        />
      ) : null}
    </div>
  );
}
