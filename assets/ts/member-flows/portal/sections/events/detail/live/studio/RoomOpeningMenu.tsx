import { LIVE_ROOM_POLICY } from "../../../../../../../../shared/live-session-policy";
import type { LiveRoomOpening } from "../../../../../../../../shared/schemas/live-room-opening";
import type { LiveRoomClientMessage } from "../../../../../../../../shared/schemas/live-session-room";
import { IconVirtual } from "../../../../../../../components/icons";
import { Menu } from "../../../../../../../ui/Menu";
import "./RoomOpeningMenu.css";

const OPENINGS: ReadonlyArray<{ id: LiveRoomOpening; label: string; short: string; description: string }> = [
  {
    id: "scheduled",
    label: "On schedule",
    short: "Scheduled",
    description: `Questions and polls now. Chat and reactions from ${LIVE_ROOM_POLICY.opensBeforeStartMinutes} minutes before the start.`,
  },
  {
    id: "open",
    label: "Open now",
    short: "Open",
    description: "Everything opens, until you change this or load another session.",
  },
  {
    id: "closed",
    label: "Closed",
    short: "Closed",
    description:
      "Attendees cannot chat, react, ask questions or answer polls, until you change this or load another session.",
  },
];

/**
 * Whether attendees take part in this session's virtual room: on schedule, or opened or closed by an
 * operator, to test the room, let a discussion run on, or stop it. The choice holds until changed or until
 * the studio loads another session, which hands it back to the schedule.
 */
export function RoomOpeningMenu({
  opening,
  disabled,
  send,
}: {
  opening: LiveRoomOpening;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
}) {
  const current = OPENINGS.find((choice) => choice.id === opening) ?? OPENINGS[0]!;
  return (
    <Menu
      variant="plain"
      label={`Virtual room: ${current.label}`}
      title={`Virtual room: ${current.label}\nWhether attendees can chat, react, ask questions and answer polls.`}
      heading="Virtual room"
      triggerClass="pk-studio-opening"
      disabled={disabled}
      items={OPENINGS.map((choice) => ({
        id: choice.id,
        label: choice.label,
        description: choice.description,
        checked: choice.id === opening,
        onSelect: () => void send({ type: "room.opening", opening: choice.id }),
      }))}
    >
      <IconVirtual />
      {current.short}
      <span aria-hidden="true">▾</span>
    </Menu>
  );
}
