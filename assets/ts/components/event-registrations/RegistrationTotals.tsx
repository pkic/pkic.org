/**
 * The registration list's figures. Every card counts people the same way:
 * the figure is everyone in it, beside it is how many of them are confirmed
 * and expected to attend, the line under it breaks the rest down, and the
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
import { IconCheckmark } from "../../ui/MediaIcons";
import type { StatCardTone } from "../../ui/StatCard";
import { CollectionTotals, type CollectionTotal } from "../CollectionTotals";

import "./RegistrationTotals.css";
import { formatNumber } from "../../../shared/format-number";
import { statusTone } from "../../../shared/status-display";
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

/**
 * Where the figures lead when the list is on another page, such as the
 * event's Overview: the address of the list narrowed by a card's filters.
 */
export interface RegistrationTotalsLinks {
  href: (filter: CardFilter) => string;
}

/** What pressing a figure does: narrow the list beside it, or open it narrowed. */
type CardTarget = RegistrationTotalsFilters | RegistrationTotalsLinks;

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
 * A toggle for a card or one of its figures: pressing it lists exactly the
 * people it counts, clearing every other filter; pressing it again, or the
 * registered card, lists everyone.
 */
function toggle(filter: CardFilter, filters: RegistrationTotalsFilters): { pressed: boolean; onPress: () => void } {
  const pressed = isApplied(filter, filters.current);
  const cleared = Object.fromEntries(Object.keys(filters.current).map((param) => [param, ""]));
  return { pressed, onPress: () => filters.apply(pressed ? cleared : { ...cleared, ...filter }) };
}

function action(filter: CardFilter, target: CardTarget): { href: string } | ReturnType<typeof toggle> {
  return "href" in target ? { href: target.href(filter) } : toggle(filter, target);
}

/** A part of a card's figure, and the filters that list just it. */
interface PartSource {
  count: number;
  /** In the line under the figure: "356 waitlisted". */
  word: string;
  /** In the tooltip's row: "On a waitlist for at least one day". */
  description: string;
  tone: StatCardTone;
  /** The filters that list exactly these people, on top of the card's scope. */
  filter: CardFilter;
}

/** What one card counts. Every card is drawn from this shape, by one builder. */
interface CardSource {
  label: string;
  /** The tooltip's first line: exactly who the figure counts. */
  title: string;
  total: number;
  /** The filters that list the people the figure counts; null when the list cannot narrow to them. */
  filter: CardFilter | null;
  /** What the card's parts are narrowed to as well: its attendance type. */
  scope?: CardFilter;
  /**
   * The people expected to attend: confirmed, and not waiting for a seat.
   * The card states it beside its figure, the most important part of it.
   */
  confirmed?: { count: number; definition: string };
  pending?: number;
  waitlisted?: number;
  cancelled?: number;
  /** Whether `cancelled` is part of `total` or counted apart from it. */
  cancelledInTotal?: boolean;
  icon?: ComponentChildren;
  tone?: StatCardTone;
  pressLabel?: string;
}

/**
 * One card: the figure, its pending, waitlisted and cancelled parts under it,
 * and the same parts as rows in its tooltip. Each part filters the list to
 * its people, as the card does to all of them. A live waitlist is the state
 * that asks for action, so it tones the card.
 */
function registrationCard(source: CardSource, target: CardTarget | undefined): CollectionTotal {
  const { pending = 0, waitlisted = 0, cancelled = 0 } = source;
  const scope = source.scope ?? {};
  const parts: PartSource[] = [
    {
      count: pending,
      word: "pending",
      description: "Email address not confirmed yet",
      tone: statusTone("pending_email_confirmation"),
      filter: { ...scope, status: "pending_email_confirmation" },
    },
    {
      count: waitlisted,
      word: "waitlisted",
      description: "On a waitlist for at least one day",
      tone: statusTone("waitlisted"),
      filter: { ...scope, status: LIVE_STATUSES, waitlisted: "true" },
    },
    {
      count: cancelled,
      word: "cancelled",
      description: source.cancelledInTotal ? "Cancelled" : "Cancelled, not counted",
      tone: statusTone("cancelled"),
      filter: { ...scope, status: "cancelled" },
    },
  ].filter((part) => part.count > 0);
  const pressable = target && source.filter ? target : undefined;
  // "In-person registrations", or just "registrations" for the card that counts them all.
  const whose = source.label === "registered" ? "registrations" : `${source.label} registrations`;
  // Confirmed and not waitlisted: on the whole event for the registered card,
  // on at least one day of the type for an attendance card.
  const confirmedFilter = { ...scope, status: "registered", waitlisted: "false" };
  return {
    label: source.label,
    value: source.total,
    icon: source.icon,
    ...(source.confirmed
      ? {
          highlight: {
            text: `${formatNumber(source.confirmed.count)} confirmed`,
            icon: <IconCheckmark />,
            ...(pressable
              ? {
                  ...action(confirmedFilter, pressable),
                  pressLabel: `Show only the ${formatNumber(source.confirmed.count)} confirmed ${whose}`,
                }
              : {}),
          },
        }
      : {}),
    ...(pressable && source.filter
      ? { ...action(source.filter, pressable), pressLabel: source.pressLabel ?? `Show ${source.label} only` }
      : {}),
    breakdown: parts.map((part) => ({
      text: `${formatNumber(part.count)} ${part.word}`,
      ...(pressable
        ? {
            ...action(part.filter, pressable),
            pressLabel: `Show only the ${formatNumber(part.count)} ${part.word} ${whose}`,
          }
        : {}),
    })),
    tone: source.tone ?? (waitlisted > 0 ? "warn" : undefined),
    tooltip: (
      <div class="pk-totals-tip">
        <p class="pk-totals-tip__title">{source.title}</p>
        {(source.confirmed || parts.length > 0) && (
          <dl class="pk-totals-tip__rows">
            {source.confirmed && (
              <div class="pk-totals-tip__row pk-totals-tip__row--ok pk-totals-tip__row--lead">
                <dt>
                  Confirmed
                  <span class="pk-totals-tip__definition">{source.confirmed.definition}</span>
                </dt>
                <dd>{formatNumber(source.confirmed.count)}</dd>
              </div>
            )}
            {parts.map((part) => (
              <div key={part.word} class={`pk-totals-tip__row pk-totals-tip__row--${part.tone}`}>
                <dt>{part.description}</dt>
                <dd>{formatNumber(part.count)}</dd>
              </div>
            ))}
          </dl>
        )}
        {pressable && !("href" in pressable) && (
          <p class="pk-totals-tip__hint">Select the card or any figure on it to list those registrations.</p>
        )}
      </div>
    ),
  };
}

/** The card for everyone who registered: the list's first, and the event Overview's registration figure. */
export function registeredTotal(
  stats: Pick<EventAttendanceRegistrationsStats, "byStatus" | "waitlistedCount" | "confirmedCount">,
  target?: CardTarget,
): CollectionTotal {
  return registrationCard(
    {
      label: "registered",
      title: "Everyone who registered, whatever their status",
      total: Object.values(stats.byStatus).reduce((sum, count) => sum + count, 0),
      filter: {},
      pressLabel: "Show all registrations",
      confirmed: { count: stats.confirmedCount, definition: "Email confirmed, not cancelled, not on any waitlist" },
      pending: stats.byStatus.pending_email_confirmation ?? 0,
      waitlisted: stats.waitlistedCount,
      cancelled: stats.byStatus.cancelled ?? 0,
      cancelledInTotal: true,
    },
    target,
  );
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
  const items: CollectionTotal[] = [
    registeredTotal(stats, filters),
    ...attendanceOptions.flatMap((option) => {
      const counts = stats.attendanceStatusByType[option.value];
      if (!counts || counts.total + counts.cancelled === 0) return [];
      const scope = { attendance_type: option.value };
      return [
        registrationCard(
          {
            // The option's name as the settings write it: "Livestream Lounge" stays a name.
            label: option.label,
            title: `People who chose ${option.label} for at least one day, cancelled registrations aside`,
            total: counts.total,
            filter: filters?.byAttendanceType ? { ...scope, status: LIVE_STATUSES } : null,
            scope,
            confirmed: {
              count: counts.confirmed,
              definition: `Email confirmed, not cancelled, and not waitlisted on at least one of their ${option.label} days`,
            },
            pending: counts.pending,
            waitlisted: counts.waitlisted,
            cancelled: counts.cancelled,
            icon: <AttendanceIcon type={option.value} icon={option.icon} />,
          },
          filters,
        ),
      ];
    }),
  ];
  // A failed load is a card in the row, not a panel beside it: the figure it
  // cannot give, why, and pressing it loads the options again.
  if (onRetryAttendanceOptions)
    items.push({
      label: "attendance",
      value: "—",
      tone: "warn",
      note: "Could not load. Try again.",
      tooltip: "The event's attendance options could not be loaded, so their totals are not shown.",
      onPress: onRetryAttendanceOptions,
      pressLabel: "Load the attendance totals again",
    });
  const bounced = stats.bouncedCount ?? 0;
  if (bounced > 0)
    items.push(
      registrationCard(
        {
          label: "bounced",
          title: "Registrations whose confirmation email bounced",
          total: bounced,
          filter: { bounced: "true" },
          tone: "danger",
        },
        filters,
      ),
    );
  return <CollectionTotals label="Registration totals" items={items} />;
}
