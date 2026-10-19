/**
 * A registration's days, grouped by what they amount to.
 *
 * Three confirmed in-person days are one fact — "in person, all three days" —
 * not three rows saying the same thing. Days only split into separate groups
 * when they differ: a seat on offer, a place on the waiting list, or a
 * different way of joining. The order puts what needs the attendee first.
 */

export type DayStatusKind = "offered" | "waiting" | "confirmed" | "cancelled";

export interface DayStatusGroup {
  kind: DayStatusKind;
  /** How the confirmed days are joined; null for waiting-list, offered and cancelled groups. */
  attendanceType: string | null;
  dayDates: string[];
  /** The earliest offer deadline in an offered group. */
  offerExpiresAt: string | null;
}

const KIND_ORDER: Record<DayStatusKind, number> = { offered: 0, waiting: 1, confirmed: 2, cancelled: 3 };
const TYPE_ORDER = ["in_person", "virtual", "on_demand"];

export function groupRegistrationDays(
  dayAttendance: ReadonlyArray<{ dayDate: string; attendanceType: string }>,
  dayWaitlist: ReadonlyArray<{ dayDate: string; status: string; offerExpiresAt?: string | null }>,
  { cancelled = false }: { cancelled?: boolean } = {},
): DayStatusGroup[] {
  // A cancelled registration holds no day at all, whatever it once chose: one line says so.
  if (cancelled)
    return dayAttendance.length
      ? [
          {
            kind: "cancelled",
            attendanceType: null,
            dayDates: dayAttendance.map((entry) => entry.dayDate).sort(),
            offerExpiresAt: null,
          },
        ]
      : [];
  const pending = new Map(
    dayWaitlist
      .filter((entry) => entry.status === "waiting" || entry.status === "offered")
      .map((entry) => [entry.dayDate, entry]),
  );
  const groups = new Map<string, DayStatusGroup>();
  const add = (kind: DayStatusKind, attendanceType: string | null, dayDate: string, expires: string | null) => {
    const key = `${kind}:${attendanceType ?? ""}`;
    const group = groups.get(key) ?? { kind, attendanceType, dayDates: [], offerExpiresAt: null };
    group.dayDates.push(dayDate);
    if (expires && (!group.offerExpiresAt || expires < group.offerExpiresAt)) group.offerExpiresAt = expires;
    groups.set(key, group);
  };
  for (const entry of dayAttendance) {
    const queued = pending.get(entry.dayDate);
    if (queued?.status === "offered") add("offered", null, entry.dayDate, queued.offerExpiresAt ?? null);
    else if (queued) add("waiting", null, entry.dayDate, null);
    else add("confirmed", entry.attendanceType, entry.dayDate, null);
  }
  const typeRank = (type: string | null) => {
    const index = TYPE_ORDER.indexOf(type ?? "");
    return index < 0 ? TYPE_ORDER.length : index;
  };
  return [...groups.values()]
    .map((group) => ({ ...group, dayDates: [...group.dayDates].sort() }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || typeRank(a.attendanceType) - typeRank(b.attendanceType));
}

export function hasWaitingDays(groups: readonly DayStatusGroup[]): boolean {
  return groups.some((group) => group.kind === "waiting" || group.kind === "offered");
}
