/**
 * Attendance across every group a person sits in now, as one bar: each group
 * fills its share of the meetings held, and pointing at a part names the group
 * and its count. One bar instead of a meter per seat, so the record stays the
 * same size whether a person sits in two groups or twenty.
 *
 * Only current seats count, as the record's headline figures do. A seat whose
 * group has not met yet adds nothing: it has no meetings to attend or miss.
 */
import type { UserGroupParticipation } from "../../../../../shared/schemas/user-participation";
import { SegmentedBar } from "../../../../ui/SegmentedBar";

export function GroupAttendanceBar({ seats }: { seats: readonly UserGroupParticipation[] }) {
  const current = seats.filter((seat) => seat.leftAt === null && seat.held > 0);
  const held = current.reduce((sum, seat) => sum + seat.held, 0);
  if (held === 0) return null;
  const attended = current.reduce((sum, seat) => sum + seat.attended, 0);
  const label = `${String(attended)} of ${String(held)} meetings attended`;
  return (
    <div class="pk-stack pk-stack--tight">
      <p class="pk-small pk-muted pk-user-footnote">{label}</p>
      <SegmentedBar
        label={label}
        total={held}
        segments={current.map((seat) => ({
          key: `${seat.group.id}:${seat.joinedAt}`,
          label: `${seat.group.name}: ${String(seat.attended)} of ${String(seat.held)}`,
          value: seat.attended,
        }))}
      />
    </div>
  );
}
