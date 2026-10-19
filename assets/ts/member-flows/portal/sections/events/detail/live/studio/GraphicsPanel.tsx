import type { ComponentType } from "preact";
import { formatClockInZone } from "../../../../../../../../shared/format-date";
import { resolveUpcomingRooms } from "../../../../../../../../shared/live-session-schedule";
import type { AgendaSnapshot } from "../../../../../../../../shared/schemas/event-agenda";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../../../../../../../../shared/schemas/live-session-schedule";
import { LiveCheckInControls } from "../LiveCheckInControls";
import { LivePanelistControls } from "../LivePanelistControls";
import { LiveScheduleControls } from "../LiveScheduleControls";
import { LiveTickerControls } from "../LiveTickerControls";
import type { LiveTargets } from "../live-output-targets";

/** What comes next in this physical room, on the event's clock. */
export function nextInRoom(agenda: AgendaSnapshot | null, occurrenceId: string, roomId: string, now: number) {
  const schedule = resolveUpcomingRooms(
    agenda,
    occurrenceId,
    now,
    { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "this-room", layout: "list" },
    roomId,
  );
  const next = schedule.rooms[0];
  return next && schedule.timeZone ? { ...next, timeZone: schedule.timeZone } : null;
}

/** What every graphic row can read: the outputs, and where and when the session is. */
export interface LiveGraphicContext {
  targets: LiveTargets;
  slug: string;
  approvedAgenda: AgendaSnapshot | null;
  occurrenceId: string;
  roomId: string;
  now: number;
}

/**
 * The Graphics panel's rows, in order. A new graphic is one entry here: its
 * row (name, settings, output control over a `LiveLayer`) and when it
 * applies. The composition it toggles lives in the shared stage contract.
 */
export const LIVE_GRAPHICS: ReadonlyArray<{
  id: string;
  applies?: (context: LiveGraphicContext) => boolean;
  Row: ComponentType<LiveGraphicContext>;
}> = [
  {
    id: "panel",
    // A line-up of every speaker only means something when there is more than one.
    applies: ({ targets }) => targets.state.session.credits.length > 1,
    Row: ({ targets }) => <LivePanelistControls targets={targets} />,
  },
  { id: "ticker", Row: ({ targets }) => <LiveTickerControls targets={targets} /> },
  {
    id: "check-in",
    Row: ({ targets, slug, occurrenceId }) => (
      <LiveCheckInControls targets={targets} slug={slug} occurrenceId={occurrenceId} />
    ),
  },
  {
    id: "up-next",
    Row: ({ targets, approvedAgenda, occurrenceId, roomId, now }) => {
      const next = nextInRoom(approvedAgenda, occurrenceId, roomId, now);
      return (
        <LiveScheduleControls
          targets={targets}
          detail={
            next ? `${formatClockInZone(next.startAt, next.timeZone)} · ${next.title}` : "Nothing next in this room"
          }
        />
      );
    },
  },
];

/** The room's graphics beyond people and questions, each with its own outputs. */
export function GraphicsPanel(context: LiveGraphicContext) {
  return (
    <div>
      {LIVE_GRAPHICS.filter((graphic) => graphic.applies?.(context) ?? true).map(({ id, Row }) => (
        <Row key={id} {...context} />
      ))}
    </div>
  );
}
