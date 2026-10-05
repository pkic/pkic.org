import type { z } from "zod";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  agendaScheduleProposalSchema,
  AGENDA_SCHEDULE_BATCH_LIMIT,
  type AgendaScheduleProposal,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import { adjacentAgendaSession } from "../../../../../../../shared/event-agenda-order";
import {
  agendaOccurrenceListSchema,
  type AgendaSnapshot,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
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
  const [timeStep, setTimeStep] = useState(5);
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
    if (session && snapshot) setProposal(scheduleMove(snapshot, session, startAt, roomId || null));
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
    setProposal(
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
  function step(ids: ReadonlySet<string>, direction: -1 | 1) {
    if (!snapshot) return;
    try {
      setProposal(scheduleStep(snapshot, ids, direction));
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Unable to prepare the schedule change.");
    }
  }
  return {
    timeStep,
    setTimeStep,
    move,
    resize,
    preview: setProposal,
    actions: (session: AgendaOccurrence) => [
      {
        id: "unschedule",
        label: "Unschedule session",
        disabled: busy || !snapshot || (!session.startAt && !session.endAt),
        onSelect: () => {
          if (busy || !snapshot || (!session.startAt && !session.endAt)) return;
          setProposal(scheduleUnschedule(snapshot, session));
        },
      },
      {
        id: "up",
        label: "Move up in agenda",
        disabled: busy || !snapshot || !adjacentAgendaSession(snapshot.occurrences, session, snapshot.timeZone, -1),
        onSelect: () => step(new Set([session.id]), -1),
      },
      {
        id: "down",
        label: "Move down in agenda",
        disabled: busy || !snapshot || !adjacentAgendaSession(snapshot.occurrences, session, snapshot.timeZone, 1),
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
