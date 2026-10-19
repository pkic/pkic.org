/**
 * The event's standing at a glance, at the head of its Overview: how many
 * people are registered, how many proposals wait for a decision, and whether
 * the agenda the public sees is the one being planned.
 *
 * Each figure is the server's own count — the list endpoints answer one row
 * and their totals — and links to the tab behind it. A figure the reader has
 * no access to is not drawn, and one that fails to load leaves the others.
 */
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { eventAttendanceRegistrationsListResponseSchema } from "../../../../../shared/schemas/event-registrations";
import { eventProposalsResponseSchema } from "../../../../../shared/schemas/event-proposals";
import { agendaOccurrenceListSchema } from "../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../shared/format-number";
import { getJson } from "../../../../shared/api-client";
import { useData } from "../../../../hooks/useData";
import { StatCard, type StatCardTone } from "../../../../ui/StatCard";

export interface GroupEventGlanceProps {
  event: GroupEvent;
  groupId: string;
  /** The workspace tabs this reader can open; a figure shows only beside its tab. */
  visibleTabs: ReadonlySet<string>;
  /** The address of a workspace tab. */
  tabHref: (tab: string) => string;
}

function RegistrationsFigure({ event, groupId, href }: { event: GroupEvent; groupId: string; href: string }) {
  const registrations = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}/registrations?limit=1`,
        eventAttendanceRegistrationsListResponseSchema,
      ),
    [groupId, event.id],
  );
  if (!registrations.data) return null;
  const registered = registrations.data.stats.byStatus.registered ?? 0;
  return <StatCard label="Registrations" value={formatNumber(registered)} href={href} />;
}

function ProposalsFigure({ event, href }: { event: GroupEvent; href: string }) {
  const proposals = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(event.slug)}/proposals?limit=1`, eventProposalsResponseSchema),
    [event.slug],
  );
  if (!proposals.data) return null;
  const { byStatus } = proposals.data.stats;
  const toReview = (byStatus.submitted ?? 0) + (byStatus.under_review ?? 0);
  return (
    <StatCard
      label="Proposals to review"
      value={formatNumber(toReview)}
      // A queue is worth coloring only while something is in it.
      tone={toReview > 0 ? "warn" : undefined}
      href={href}
    />
  );
}

/** Whether the public agenda matches the planned one, from the sessions' publication states. */
function agendaStanding(total: number, published: number): { value: string; note?: string; tone?: StatCardTone } {
  if (total === 0) return { value: "No sessions yet" };
  if (published === total) return { value: "Published", tone: "ok" };
  if (published === 0) return { value: "Not published", note: `${formatNumber(total)} sessions planned` };
  const pending = total - published;
  return {
    value: "Changes to publish",
    note: `${formatNumber(pending)} of ${formatNumber(total)} sessions`,
    tone: "warn",
  };
}

function AgendaFigure({ event, href }: { event: GroupEvent; href: string }) {
  const base = `/api/v1/events/${encodeURIComponent(event.slug)}/agenda/occurrences?limit=1`;
  const agenda = useData(
    () =>
      Promise.all([
        getJson(base, agendaOccurrenceListSchema),
        getJson(`${base}&publicationStatus=published`, agendaOccurrenceListSchema),
      ]),
    [event.slug],
  );
  if (!agenda.data) return null;
  const [all, published] = agenda.data;
  const standing = agendaStanding(all.page.total, published.page.total);
  return <StatCard label="Agenda" value={standing.value} note={standing.note} tone={standing.tone} href={href} />;
}

export function GroupEventGlance({ event, groupId, visibleTabs, tabHref }: GroupEventGlanceProps) {
  const figures = [
    visibleTabs.has("registrations") && (
      <RegistrationsFigure key="registrations" event={event} groupId={groupId} href={tabHref("registrations")} />
    ),
    visibleTabs.has("proposals") && <ProposalsFigure key="proposals" event={event} href={tabHref("proposals")} />,
    visibleTabs.has("agenda") && <AgendaFigure key="agenda" event={event} href={tabHref("agenda")} />,
  ].filter(Boolean);
  if (figures.length === 0) return null;
  return (
    <div class="pk-stat-row" role="group" aria-label="Event at a glance">
      {figures}
    </div>
  );
}
