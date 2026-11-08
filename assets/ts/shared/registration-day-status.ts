/**
 * A registration's days, grouped by what they amount to.
 *
 * Three confirmed in-person days are one fact — "in person, all three days" —
 * not three rows saying the same thing. Days only split into separate groups
 * when they differ: a seat on offer, a place on the waiting list, or a
 * different way of joining. The order puts what needs the attendee first.
 */

export type DayStatusKind = "offered" | "waiting" | "expired" | "confirmed" | "cancelled";

export interface DayStatusGroup {
  kind: DayStatusKind;
  /** The selected option; null for a cancelled registration or a waitlisted day without an attendance choice. */
  attendanceType: string | null;
  optionLabel: string | null;
  dayDates: string[];
  /** The earliest offer deadline in an offered group. */
  offerExpiresAt: string | null;
}

const KIND_ORDER: Record<DayStatusKind, number> = { offered: 0, expired: 1, waiting: 2, confirmed: 3, cancelled: 4 };
const TYPE_ORDER = ["in_person", "virtual", "on_demand"];

export function groupRegistrationDays(
  dayAttendance: ReadonlyArray<{ dayDate: string; attendanceType: string; optionLabel?: string | null }>,
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
            optionLabel: null,
            dayDates: dayAttendance.map((entry) => entry.dayDate).sort(),
            offerExpiresAt: null,
          },
        ]
      : [];
  const pending = new Map(
    dayWaitlist
      .filter((entry) => entry.status === "waiting" || entry.status === "offered" || entry.status === "expired")
      .map((entry) => [entry.dayDate, entry]),
  );
  const groups = new Map<string, DayStatusGroup>();
  const add = (
    kind: DayStatusKind,
    attendanceType: string | null,
    optionLabel: string | null,
    dayDate: string,
    expires: string | null,
  ) => {
    const key = JSON.stringify([kind, attendanceType, optionLabel]);
    const group = groups.get(key) ?? { kind, attendanceType, optionLabel, dayDates: [], offerExpiresAt: null };
    group.dayDates.push(dayDate);
    if (expires && (!group.offerExpiresAt || expires < group.offerExpiresAt)) group.offerExpiresAt = expires;
    groups.set(key, group);
  };
  for (const entry of dayAttendance) {
    const queued = pending.get(entry.dayDate);
    if (queued?.status === "offered")
      add("offered", entry.attendanceType, entry.optionLabel ?? null, entry.dayDate, queued.offerExpiresAt ?? null);
    else if (queued?.status === "expired")
      add("expired", entry.attendanceType, entry.optionLabel ?? null, entry.dayDate, null);
    else if (queued) add("waiting", entry.attendanceType, entry.optionLabel ?? null, entry.dayDate, null);
    else add("confirmed", entry.attendanceType, entry.optionLabel ?? null, entry.dayDate, null);
  }
  const selectedDates = new Set(dayAttendance.map((entry) => entry.dayDate));
  for (const [dayDate, queued] of pending) {
    if (
      !selectedDates.has(dayDate) &&
      (queued.status === "waiting" || queued.status === "offered" || queued.status === "expired")
    )
      add(queued.status, null, null, dayDate, queued.offerExpiresAt ?? null);
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
  return groups.some((group) => group.kind === "waiting" || group.kind === "offered" || group.kind === "expired");
}
