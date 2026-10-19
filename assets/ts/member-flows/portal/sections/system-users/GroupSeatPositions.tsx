/**
 * The group seats a person holds or held as one identity, as positions under
 * that identity's experience entry: the role and the group, and when it was
 * held. Attendance is not repeated per seat; the record states it once, as one
 * bar across every group, so the entry stays the same size however many
 * groups a person sits in.
 */
import type { UserGroupParticipation } from "../../../../../shared/schemas/user-participation";
import { formatTenure } from "../../../../shared/ui";
import { PositionTimeline } from "../../../../ui/PositionTimeline";
import { usePortalHashLocation } from "../../hash-location";

export function GroupSeatPositions({ seats }: { seats: readonly UserGroupParticipation[] }) {
  return (
    <PositionTimeline
      label="Group roles"
      positions={seats.map((seat) => ({
        key: `${seat.group.id}:${seat.joinedAt}`,
        past: seat.leftAt !== null,
        title: (
          <>
            {seat.title ? `${seat.title}, ` : null}
            <a href={usePortalHashLocation.hrefs(`/groups/${encodeURIComponent(seat.group.id)}`)}>{seat.group.name}</a>
          </>
        ),
        when: formatTenure(seat.joinedAt, seat.leftAt),
      }))}
    />
  );
}
