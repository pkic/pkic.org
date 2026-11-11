/**
 * The registration list's figures. Every card counts people the same way:
 * the figure is everyone in it, the line under it breaks that down, and the
 * label opens a tooltip that says exactly what was counted. There is one
 * attendance card for each option the event's attendance settings offer, in
 * its wording and with its icon. It counts each person who chose that option
 * on at least one day, the same test the list's attendance filter applies.
 *
 * Pressing a card sets the list's filters to the ones that list exactly the
 * people it counts, and clears the rest. An attendance card counts cancelled
 * registrations aside, so it filters by its type and by every status but
 * cancelled; the attendance filter alone keeps cancellations in the list, so
 * an organizer can still find them.
 */
import type { ComponentChildren } from "preact";
import { AttendanceIcon } from "../AttendanceIcon";
import type { StatCardTone } from "../../ui/StatCard";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { CollectionTotals, type CollectionTotal } from "../CollectionTotals";
import { formatNumber } from "../../../shared/format-number";
import type { EventAttendanceOption } from "../../../shared/schemas/event-configuration";
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

/** What one card counts. Every card is drawn from this shape, by one builder. */
interface CardSource {
  label: string;
  /** The tooltip's first line: exactly who the figure counts. */
  title: string;
  total: number;
  pending?: number;
  waitlisted?: number;
  cancelled?: number;
  /** Whether `cancelled` is part of `total` or counted apart from it. */
  cancelledInTotal?: boolean;
  icon?: ComponentChildren;
  tone?: StatCardTone;
}

/**
 * One card: the figure, the pending, waitlisted and cancelled parts under it,
 * and the same parts in words in its tooltip. A live waitlist is the state
 * that asks for action, so it tones the card.
 */
function registrationCard(source: CardSource): CollectionTotal {
  const { pending = 0, waitlisted = 0, cancelled = 0 } = source;
  return {
    label: source.label,
    value: source.total,
    icon: source.icon,
    note: breakdown([
      [pending, "pending"],
      [waitlisted, "waitlisted"],
      [cancelled, "cancelled"],
    ]),
    tone: source.tone ?? (waitlisted > 0 ? "warn" : undefined),
    tooltip: (
      <div class="pk-stack pk-stack--tight">
        <strong>{source.title}</strong>
        {pending > 0 && (
          <span>
            {formatNumber(pending)} {pending === 1 ? "has" : "have"} not confirmed their email address yet
          </span>
        )}
        {waitlisted > 0 && (
          <span>
            {formatNumber(waitlisted)} {waitlisted === 1 ? "is" : "are"} on the waitlist for at least one day
          </span>
        )}
        {cancelled > 0 && (
          <span>
            {formatNumber(cancelled)} cancelled their registration
            {source.cancelledInTotal ? "" : ` and ${cancelled === 1 ? "is" : "are"} not counted`}
          </span>
        )}
      </div>
    ),
  };
}

export function RegistrationTotals({
  stats,
  attendanceOptions,
  filters,
  onRetryAttendanceOptions,
}: {
  stats: EventAttendanceRegistrationsStats & { bouncedCount?: number };
  /** The attendance options the event's settings offer: one card each, with its wording and icon. */
  attendanceOptions: readonly EventAttendanceOption[];
  /** Makes the cards set the list's filters; without it they are figures only. */
  filters?: RegistrationTotalsFilters;
  /** The attendance options failed to load: say so, and offer to load them again. */
  onRetryAttendanceOptions?: () => void;
}) {
  const withFilter = (item: CollectionTotal, filter: CardFilter | null, pressLabel = `Show ${item.label} only`) =>
    filters && filter ? pressable(item, filter, filters, pressLabel) : item;
  const total = Object.values(stats.byStatus).reduce((sum, count) => sum + count, 0);
  const items: CollectionTotal[] = [
    withFilter(
      registrationCard({
        label: "registered",
        title: "Everyone who registered, whatever their status",
        total,
        pending: stats.byStatus.pending_email_confirmation ?? 0,
        waitlisted: stats.waitlistedCount,
        cancelled: stats.byStatus.cancelled ?? 0,
        cancelledInTotal: true,
      }),
      {},
      "Show all registrations",
    ),
    ...attendanceOptions.flatMap((option) => {
      const counts = stats.attendanceStatusByType[option.value];
      if (!counts || counts.total + counts.cancelled === 0) return [];
      const card = registrationCard({
        // The option's name as the settings write it: "Livestream Lounge" stays a name.
        label: option.label,
        title: `People who chose ${option.label} for at least one day, cancelled registrations aside`,
        total: counts.total,
        pending: counts.pending,
        waitlisted: counts.waitlisted,
        cancelled: counts.cancelled,
        icon: <AttendanceIcon type={option.value} icon={option.icon} />,
      });
      return [
        withFilter(card, filters?.byAttendanceType ? { status: LIVE_STATUSES, attendance_type: option.value } : null),
      ];
    }),
  ];
  const bounced = stats.bouncedCount ?? 0;
  if (bounced > 0)
    items.push(
      withFilter(
        registrationCard({
          label: "bounced",
          title: "Registrations whose confirmation email bounced",
          total: bounced,
          tone: "danger",
        }),
        { bounced: "true" },
      ),
    );
  return (
    <>
      <CollectionTotals label="Registration totals" items={items} />
      {onRetryAttendanceOptions && (
        <Alert tone="warn" title="Attendance totals are not shown">
          <p>The event's attendance options could not be loaded.</p>
          <Button onClick={onRetryAttendanceOptions}>Try again</Button>
        </Alert>
      )}
    </>
  );
}
