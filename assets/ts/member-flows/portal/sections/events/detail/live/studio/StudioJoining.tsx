import { Spinner } from "../../../../../../../components/Spinner";
import type { LiveRoomConnection } from "../../../../../../../live-session/useLiveRoom";
import { liveRoomOpenFailure } from "../../../../../../../live-session/live-room-copy";
import { Alert } from "../../../../../../../ui/Alert";

/** The studio before its session's room first answers: refused, offline, or still joining. */
export function StudioJoining({ room }: { room: LiveRoomConnection }) {
  if (room.admissionRefusal)
    return <Alert tone="danger">{liveRoomOpenFailure(room.admissionRefusal, "operator")}</Alert>;
  if (room.status === "offline")
    return (
      <Alert tone={room.serverFault ? "danger" : "warn"}>
        {liveRoomOpenFailure(null, "operator", room.serverFault)}
      </Alert>
    );
  return <Spinner label="Joining the live room…" />;
}
