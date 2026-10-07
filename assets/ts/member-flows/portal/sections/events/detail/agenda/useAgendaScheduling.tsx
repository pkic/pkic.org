import { resolveAgendaDurationRules } from "../../../../../../../shared/event-agenda-duration";
import { useAgendaTimeStep } from "./useAgendaTimeStep";
import type { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  agendaScheduleProposalSchema,
  agendaScheduleReviewSchema,
  agendaScheduleApplySchema,
  AGENDA_SCHEDULE_BATCH_LIMIT,
  type AgendaScheduleProposal,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { agendaPresenter } from "./presenter";
import {
  agendaOccurrenceListSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
import { postJson } from "../../../../../../shared/api-client";
import { BulkBar } from "../../../../../../ui/BulkBar";
import { Button } from "../../../../../../ui/Button";
import { AgendaSchedulePreview } from "./AgendaSchedulePreview";
import { AgendaBulkSchedule } from "./AgendaBulkSchedule";
import { scheduleMove, scheduleStep, scheduleUnschedule } from "./schedule-proposals";
export function useAgendaScheduling(
  scope: string,
  snapshot: AgendaSnapshot | undefined | null,
  busy: boolean,
  onSaved: (snapshot: AgendaSnapshot) => void,
  onCommitted: () => void,
  onError: (message: string) => void,
) {
  const { timeStep, setTimeStep } = useAgendaTimeStep(scope);
  const planningDays = useMemo(() => (snapshot ? agendaPresenter(snapshot, timeStep) : []), [snapshot, timeStep]);
  const posting = useRef(false);
  const [applying, setApplying] = useState(false);
  async function place(proposal: AgendaScheduleProposal) {
    if (!snapshot || busy || posting.current)
      return { saved: false, message: "Another scheduling change is still being saved." };
    posting.current = true;
    setApplying(true);
    const endpoint = `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/schedule`;
    try {
      const request = agendaScheduleProposalSchema.parse(proposal);
      const reviewed = await postJson(`${endpoint}/reviews`, request, agendaScheduleReviewSchema);
      const next = await postJson(
        endpoint,
        agendaScheduleApplySchema.parse({ ...request, reviewHash: reviewed.reviewHash }),
        agendaSnapshotSchema,
      );
      onSaved(next);
      onCommitted();
      return { saved: true, message: "" };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Unable to place this session.";
      onError(message);
      return { saved: false, message };
    } finally {
      posting.current = false;
      setApplying(false);
    }
  }
  const visibleRows = useRef<ReadonlySet<string>>(new Set());
  const [proposal, setProposal] = useState<AgendaScheduleProposal | null>(null),
    [selected, setSelected] = useState<ReadonlySet<string>>(new Set()),
    [bulk, setBulk] = useState(false);
  useEffect(() => {
    setSelected(new Set());
    setProposal(null);
    setBulk(false);
  }, [scope]);
  useEffect(() => {
    if (snapshot)
      setSelected(
        (current) => new Set([...current].filter((id) => snapshot.occurrences.some((item) => item.id === id))),
      );
  }, [snapshot]);
  function select(next: ReadonlySet<string>) {
    if (busy) return;
    if (next.size > AGENDA_SCHEDULE_BATCH_LIMIT) {
      onError(`Choose at most ${AGENDA_SCHEDULE_BATCH_LIMIT} sessions for one change.`);
      return;
    }
    setSelected(next);
  }
  function move(id: string, startAt: string, roomId: string | null) {
    const session = snapshot?.occurrences.find((item) => item.id === id);
    if (session && snapshot) void place(scheduleMove(snapshot, session, startAt, roomId || null));
  }
  function resize(id: string, endAt: string, roomId: string) {
    const session = snapshot?.occurrences.find((item) => item.id === id);
    if (
      !session ||
      !snapshot ||
      !session.startAt ||
      session.roomId !== (roomId || null) ||
      Date.parse(endAt) <= Date.parse(session.startAt)
    ) {
      onError("Choose an end time after the start, in the session's current location.");
      return;
    }
    void place(
      agendaScheduleProposalSchema.parse({
        expectedRevision: snapshot.revision,
        changes: [
          {
            id,
            startAt: session.startAt,
            endAt,
            roomId: session.roomId,
            additionalRoomIds: session.additionalRoomIds ?? [],
          },
        ],
      }),
    );
  }
  function resizeStart(id: string, startAt: string, roomId: string) {
    const session = snapshot?.occurrences.find((item) => item.id === id);
    if (!session?.endAt || !snapshot || session.roomId !== (roomId || null) || startAt >= session.endAt) return;
    void place(
      agendaScheduleProposalSchema.parse({
        expectedRevision: snapshot.revision,
        changes: [
          {
            id,
            startAt,
            endAt: session.endAt,
            roomId: session.roomId,
            additionalRoomIds: session.additionalRoomIds ?? [],
          },
        ],
      }),
    );
  }
  function setRooms(id: string, roomIds: readonly string[]) {
    const session = snapshot?.occurrences.find((item) => item.id === id);
    if (!session || !snapshot)
      return Promise.resolve({ saved: false, message: "This session is no longer available." });
    const roomId = session.roomId && roomIds.includes(session.roomId) ? session.roomId : (roomIds[0] ?? null);
    return place({
      expectedRevision: snapshot.revision,
      changes: [
        {
          id,
          startAt: session.startAt,
          endAt: session.endAt,
          roomId,
          additionalRoomIds: roomIds.filter((id) => id !== roomId),
        },
      ],
    });
  }
  function canMoveRoom(id: string, direction: -1 | 1) {
    const session = snapshot?.occurrences.find((item) => item.id === id);
    const index = snapshot?.rooms.findIndex((room) => room.id === session?.roomId) ?? -1;
    return Boolean(session?.startAt && index >= 0 && snapshot?.rooms[index + direction]);
  }
  function moveRoom(id: string, direction: -1 | 1) {
    const session = snapshot?.occurrences.find((item) => item.id === id);
    if (!session || !snapshot || !session.startAt) return;
    const index = snapshot.rooms.findIndex((room) => room.id === session.roomId);
    const destination = snapshot.rooms[index + direction];
    if (index >= 0 && destination) move(id, session.startAt, destination.id);
  }
  function setDuration(id: string, minutes: number) {
    const session = snapshot?.occurrences.find((item) => item.id === id);
    if (!session?.startAt || !Number.isFinite(minutes) || minutes <= 0) return;
    resize(id, new Date(Date.parse(session.startAt) + minutes * 60000).toISOString(), session.roomId ?? "");
  }
  function step(ids: ReadonlySet<string>, direction: -1 | 1) {
    if (!snapshot) return;
    try {
      void place(scheduleStep(snapshot, ids, direction, stepBounds(ids)));
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Unable to prepare the schedule change.");
    }
  }
  function stepBounds(ids: ReadonlySet<string>) {
    const session = ids.size === 1 ? snapshot?.occurrences.find((item) => ids.has(item.id)) : undefined;
    if (!snapshot || !session?.startAt) return undefined;
    const date = instantToDateTimeLocal(session.startAt, snapshot.timeZone).slice(0, 10);
    const slots = planningDays.find((day) => day.date === date)?.slots;
    return slots?.length ? { startAt: slots[0]!.startsAt, endAt: slots[slots.length - 1]!.startsAt } : undefined;
  }
  function canMoveAdjacent(id: string, direction: -1 | 1) {
    const session = snapshot?.occurrences.find((item) => item.id === id);
    if (!session || !snapshot) return false;
    try {
      scheduleStep(snapshot, new Set([id]), direction, stepBounds(new Set([id])));
      return true;
    } catch {
      return false;
    }
  }
  return {
    applying,
    timeStep,
    setTimeStep,
    durationOptions: resolveAgendaDurationRules(snapshot?.durationRules).quickMinutes,
    move,
    resize,
    setDuration,
    resizeStart,
    setRooms,
    moveRoom,
    canMoveRoom,
    canMoveAdjacent,
    moveAdjacent: (id: string, direction: -1 | 1) => step(new Set([id]), direction),
    preview: setProposal,
    apply: place,
    actions: (session: AgendaOccurrence) => [
      {
        id: "unschedule",
        label: "Unschedule session",
        disabled: busy || !snapshot || (!session.startAt && !session.endAt),
        onSelect: () => {
          if (busy || !snapshot || (!session.startAt && !session.endAt)) return;
          void place(scheduleUnschedule(snapshot, session));
        },
      },
      {
        id: "up",
        label: "Move up in agenda",
        disabled: busy || !canMoveAdjacent(session.id, -1),
        onSelect: () => step(new Set([session.id]), -1),
      },
      {
        id: "down",
        label: "Move down in agenda",
        disabled: busy || !canMoveAdjacent(session.id, 1),
        onSelect: () => step(new Set([session.id]), 1),
      },
      {
        id: "bulk",
        label: selected.has(session.id) ? "Remove from bulk selection" : "Add to bulk selection",
        disabled: busy,
        onSelect: () => {
          const next = new Set(selected);
          if (next.has(session.id)) next.delete(session.id);
          else next.add(session.id);
          select(next);
        },
      },
    ],
    onTableData: (response: z.infer<typeof agendaOccurrenceListSchema>) => {
      visibleRows.current = new Set(response.occurrences.map((item) => item.id));
    },
    selection: {
      selected,
      onChange: (next: ReadonlySet<string>) =>
        select(new Set([...selected].filter((id) => !visibleRows.current.has(id)).concat([...next]))),
      rowLabel: (id: string) => snapshot?.occurrences.find((item) => item.id === id)?.title ?? id,
    },
    bar: snapshot && (
      <BulkBar count={selected.size} total={snapshot.occurrences.length} onClear={() => setSelected(new Set())}>
        <Button disabled={busy} onClick={() => setBulk(true)}>
          Move selected sessions
        </Button>
        <Button disabled={busy} onClick={() => step(selected, -1)}>
          Move selected up
        </Button>
        <Button disabled={busy} onClick={() => step(selected, 1)}>
          Move selected down
        </Button>
      </BulkBar>
    ),
    panel:
      snapshot &&
      (proposal ? (
        <AgendaSchedulePreview
          key={JSON.stringify(proposal)}
          snapshot={snapshot}
          proposal={proposal}
          onClose={() => setProposal(null)}
          onSaved={(next) => {
            onSaved(next);
            onCommitted();
            setBulk(false);
            setSelected(new Set());
          }}
        />
      ) : bulk ? (
        <AgendaBulkSchedule
          snapshot={snapshot}
          selected={selected}
          onClose={() => setBulk(false)}
          onProposal={setProposal}
        />
      ) : null),
  };
}
