/**
 * The registration list's figures. Every card counts people the same way:
 * the figure is everyone in it, the line under it breaks that down, and the
 * label opens a tooltip that says exactly what was counted. An attendance
 * figure counts each person who chose that attendance on at least one day,
 * the same test the list's attendance filter applies, so a card and its
 * filtered list agree.
 *
 * Pressing a card sets the list's filters to the ones that list exactly the
 * people it counts, and clears the rest. An attendance card counts cancelled
 * registrations aside, so it filters by its type and by every status but
 * cancelled; the attendance filter alone keeps cancellations in the list, so
 * an organizer can still find them.
 */
import { AttendanceIcon } from "../AttendanceIcon";
import { CollectionTotals, type CollectionTotal } from "../CollectionTotals";
import { formatNumber } from "../../../shared/format-number";
import { ATTENDANCE_TYPE_LABELS, attendanceTypeLabel } from "../../shared/attendance";
import {
  EVENT_REGISTRATION_STATUSES,
  type EventAttendanceRegistrationsStats,
} from "../../../shared/schemas/event-registrations";

/** The list's filters, and how a card sets them. */
export interface RegistrationTotalsFilters {
  /** The list's column filters now, without its search, sort or page. */
  current: Readonly<Record<string, string>>;
  /** Sets several filters as one change; an empty value clears one. */
  apply: (changes: Readonly<Record<string, string>>) => void;
  /** Whether the list narrows by attendance type, so an attendance card can filter it. */
  byAttendanceType: boolean;
}

type CardFilter = Readonly<Record<string, string>>;

/** What a list query holds besides its column filters. */
const NOT_FILTERS = new Set(["q", "sort", "limit", "offset"]);

/** The column filters in a list's query: what a card sets and compares against. */
export function listFilters(query: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(query).filter(([param]) => !NOT_FILTERS.has(param)));
}

/** Every status an attendance card counts: all of them, cancelled aside. */
const LIVE_STATUSES = EVENT_REGISTRATION_STATUSES.filter((status) => status !== "cancelled").join(",");

/** The card's filters are applied, and nothing else narrows the list. */
function isApplied(filter: CardFilter, current: Readonly<Record<string, string>>): boolean {
  // A set filter is the same whichever order its values were chosen in.
  const values = (value: string | undefined) => (value ?? "").split(",").sort().join(",");
  const applied = Object.entries(current).filter(([, value]) => value);
  return (
    applied.length === Object.keys(filter).length &&
    applied.every(([param, value]) => values(filter[param]) === values(value))
  );
}

/**
 * A card's toggle: pressing it lists exactly the people it counts, clearing
 * every other filter; pressing it again, or the registered card, lists everyone.
 */
function pressable(
  item: CollectionTotal,
  filter: CardFilter,
  filters: RegistrationTotalsFilters,
  pressLabel: string,
): CollectionTotal {
  const pressed = isApplied(filter, filters.current);
  const cleared = Object.fromEntries(Object.keys(filters.current).map((param) => [param, ""]));
  return {
    ...item,
    pressed,
    pressLabel,
    onPress: () => filters.apply(pressed ? cleared : { ...cleared, ...filter }),
  };
}

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
  filters,
}: {
  stats: EventAttendanceRegistrationsStats & { bouncedCount?: number };
  /** Makes the cards set the list's filters; without it they are figures only. */
  filters?: RegistrationTotalsFilters;
}) {
  const attendanceTypes = new Set([
    ...Object.keys(ATTENDANCE_TYPE_LABELS).filter((type) => type !== "not_attending"),
    ...Object.keys(stats.attendanceStatusByType).filter((type) => type !== "not_attending"),
  ]);
  const withFilter = (item: CollectionTotal, filter: CardFilter | null, pressLabel = `Show ${item.label} only`) =>
    filters && filter ? pressable(item, filter, filters, pressLabel) : item;
  const items: CollectionTotal[] = [
    withFilter(registeredTotal(stats), {}, "Show all registrations"),
    ...[...attendanceTypes].flatMap((type) => {
      const item = attendanceTotal(type, stats);
      return item
        ? [withFilter(item, filters?.byAttendanceType ? { status: LIVE_STATUSES, attendance_type: type } : null)]
        : [];
    }),
  ];
  if ((stats.bouncedCount ?? 0) > 0)
    items.push(withFilter({ label: "bounced", value: stats.bouncedCount ?? 0, tone: "danger" }, { bounced: "true" }));
  return <CollectionTotals label="Registration totals" items={items} />;
}
