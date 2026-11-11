/**
 * The registration list's figures. Every card counts people the same way:
 * the figure is everyone in it, the line under it breaks that down, and the
 * label opens a tooltip that says exactly what was counted. An attendance
 * figure counts each person who chose that attendance on at least one day,
 * the same test the list's attendance filter applies, so a card and its
 * filtered list agree.
 */
import { AttendanceIcon } from "../AttendanceIcon";
import { CollectionTotals, type CollectionTotal } from "../CollectionTotals";
import { formatNumber } from "../../../shared/format-number";
import { ATTENDANCE_TYPE_LABELS, attendanceTypeLabel } from "../../shared/attendance";
import type { EventAttendanceRegistrationsStats } from "../../../shared/schemas/event-registrations";

/** "1 pending · 356 waitlisted": the non-zero parts, in order. */
function breakdown(parts: ReadonlyArray<readonly [number, string]>): string | undefined {
  const shown = parts.filter(([count]) => count > 0).map(([count, word]) => `${formatNumber(count)} ${word}`);
  return shown.length ? shown.join(" · ") : undefined;
}

function Explanation({ title, lines }: { title: string; lines: ReadonlyArray<string | null> }) {
  return (
    <div class="pk-stack pk-stack--tight">
      <strong>{title}</strong>
      {lines.filter(Boolean).map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}

function registeredTotal(stats: EventAttendanceRegistrationsStats): CollectionTotal {
  const total = Object.values(stats.byStatus).reduce((sum, count) => sum + count, 0);
  const pending = stats.byStatus.pending_email_confirmation ?? 0;
  const cancelled = stats.byStatus.cancelled ?? 0;
  const waitlisted = stats.waitlistedCount;
  return {
    label: "registered",
    value: total,
    note: breakdown([
      [pending, "pending"],
      [waitlisted, "waitlisted"],
      [cancelled, "cancelled"],
    ]),
    tooltip: (
      <Explanation
        title="Everyone who registered, whatever their status"
        lines={[
          pending > 0 ? `${formatNumber(pending)} have not confirmed their email address yet` : null,
          waitlisted > 0 ? `${formatNumber(waitlisted)} are on the waitlist for at least one day` : null,
          cancelled > 0 ? `${formatNumber(cancelled)} cancelled their registration` : null,
        ]}
      />
    ),
  };
}

function attendanceTotal(type: string, stats: EventAttendanceRegistrationsStats): CollectionTotal | null {
  const counts = stats.attendanceStatusByType[type];
  if (!counts || counts.total === 0) return null;
  const label = attendanceTypeLabel(type);
  return {
    label: label.toLowerCase(),
    value: counts.total,
    icon: <AttendanceIcon type={type} />,
    note:
      counts.waitlisted > 0
        ? breakdown([
            [counts.accepted, "not waitlisted"],
            [counts.waitlisted, "waitlisted"],
          ])
        : undefined,
    // A live waitlist is the one attendance figure that asks for action.
    tone: counts.waitlisted > 0 ? "warn" : undefined,
    tooltip: (
      <Explanation
        title={`People who chose ${label.toLowerCase()} for at least one day, cancelled registrations aside`}
        lines={
          counts.waitlisted > 0
            ? [
                `${formatNumber(counts.accepted)} have at least one day not on the waitlist`,
                `${formatNumber(counts.waitlisted)} are on the waitlist for at least one day`,
                "Someone with days in both counts in both.",
              ]
            : []
        }
      />
    ),
  };
}

export function RegistrationTotals({
  stats,
}: {
  stats: EventAttendanceRegistrationsStats & { bouncedCount?: number };
}) {
  const attendanceTypes = new Set([
    ...Object.keys(ATTENDANCE_TYPE_LABELS).filter((type) => type !== "not_attending"),
    ...Object.keys(stats.attendanceStatusByType).filter((type) => type !== "not_attending"),
  ]);
  const items: CollectionTotal[] = [
    registeredTotal(stats),
    ...[...attendanceTypes].flatMap((type) => attendanceTotal(type, stats) ?? []),
  ];
  if ((stats.bouncedCount ?? 0) > 0) items.push({ label: "bounced", value: stats.bouncedCount ?? 0, tone: "danger" });
  return <CollectionTotals label="Registration totals" items={items} />;
}
