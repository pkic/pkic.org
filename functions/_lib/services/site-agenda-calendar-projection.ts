import {
  PUBLIC_AGENDA_CANCELLATION_DAYS,
  PUBLIC_AGENDA_CALENDAR_ENTRY_LIMIT,
  publicAgendaCalendarSchema,
  type PublicAgendaCalendarEntry,
} from "../../../assets/shared/schemas/site-agenda-calendar";
import type { AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import { publicSessionCredits, publicSessionCreditRole } from "../../../assets/shared/session-public-credits";
import { agendaOccurrenceRoomIds } from "../../../assets/shared/event-agenda-rooms";
import { utcInstantSchema } from "../../../assets/shared/schemas/api-common";

type ActiveEntry = Extract<PublicAgendaCalendarEntry, { status: "confirmed" }>;
function representedEntries(snapshot: AgendaSnapshot): ActiveEntry[] {
  return snapshot.occurrences
    .filter((item) => item.visibility === "public" && item.startAt && item.endAt && item.endAt > item.startAt)
    .map((item) => ({
      occurrenceId: item.id,
      sequence: 0,
      updatedAt: snapshot.approvedAt!,
      startAt: item.startAt!,
      endAt: item.endAt!,
      status: "confirmed" as const,
      agendaPath: snapshot.publicAgendaPath ?? `/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/`,
      title: item.title,
      description: item.description,
      speakers: publicSessionCredits(item).map((credit) =>
        publicSessionCreditRole(item, credit) === "moderator" ? `${credit.displayName} *` : credit.displayName,
      ),
      locations: agendaOccurrenceRoomIds(item)
        .map((id) => snapshot.rooms.find((room) => room.id === id)?.name)
        .filter((name): name is string => name !== undefined),
      track: item.track ?? undefined,
    }));
}
function representation(entry: ActiveEntry) {
  return JSON.stringify([
    entry.title,
    entry.description,
    entry.speakers,
    entry.locations,
    entry.track ?? null,
    entry.startAt,
    entry.endAt,
    entry.agendaPath,
  ]);
}

/** Fold immutable approvals without exporting past people, descriptions, or materials. */
export function createPublicAgendaCalendarProjection(now: string) {
  utcInstantSchema.parse(now);
  const entries = new Map<string, PublicAgendaCalendarEntry>();
  let revision = -1;
  let latestPublic: AgendaSnapshot | undefined;
  let latestApproved: AgendaSnapshot | undefined;
  function cancelMissing(current: ReadonlySet<string>, changedAt: string) {
    for (const [id, previous] of entries) {
      if (current.has(id) || previous.status === "canceled") continue;
      entries.set(id, {
        occurrenceId: id,
        sequence: previous.sequence + 1,
        status: "canceled",
        updatedAt: changedAt,
        startAt: previous.startAt,
        endAt: previous.endAt,
      });
    }
  }
  function expose(snapshot: AgendaSnapshot, changedAt: string) {
    latestPublic = snapshot;
    const current = representedEntries({ ...snapshot, approvedAt: changedAt });
    if (new Set(current.map((item) => item.occurrenceId)).size !== current.length)
      throw new Error("PUBLIC_CALENDAR_OCCURRENCE_CONFLICT");
    cancelMissing(new Set(current.map((item) => item.occurrenceId)), changedAt);
    for (const item of current) {
      const previous = entries.get(item.occurrenceId);
      if (previous?.status === "confirmed" && representation(previous) === representation(item)) continue;
      entries.set(item.occurrenceId, { ...item, sequence: previous ? previous.sequence + 1 : 0 });
    }
    if (entries.size > PUBLIC_AGENDA_CALENDAR_ENTRY_LIMIT) throw new Error("PUBLIC_CALENDAR_HISTORY_BUDGET_EXCEEDED");
  }
  return {
    append(snapshot: AgendaSnapshot) {
      if (snapshot.revision <= revision) throw new Error("PUBLIC_CALENDAR_HISTORY_ORDER_INVALID");
      revision = snapshot.revision;
      latestApproved = snapshot;
      // An old unmarked approval cannot prove historical event visibility.
      if (snapshot.calendarPublic === undefined) return;
      const changedAt = utcInstantSchema.parse(snapshot.approvedAt);
      if (snapshot.calendarPublic) expose(snapshot, changedAt);
      else cancelMissing(new Set(), changedAt);
    },
    visibility(isPublic: boolean, changedAt: string) {
      utcInstantSchema.parse(changedAt);
      if (!isPublic) cancelMissing(new Set(), changedAt);
      // Audited visibility must not backfill an unmarked historical approval.
      else if (latestApproved?.calendarPublic !== undefined) expose(latestApproved, changedAt);
    },
    finish(currentPublic: boolean, agendaPath?: string) {
      // Current public extraction is authoritative even for an old unmarked fixture.
      if (currentPublic && latestApproved)
        expose(
          { ...latestApproved, publicAgendaPath: agendaPath ?? latestApproved.publicAgendaPath },
          utcInstantSchema.parse(latestApproved.approvedAt),
        );
      if (!latestPublic) return undefined;
      // Suppress prior public details even when a withdrawal clock is unproven; no invented cancellation.
      const unprovenWithdrawal = !currentPublic && [...entries.values()].some((entry) => entry.status === "confirmed");
      const retained = unprovenWithdrawal
        ? []
        : [...entries.values()].filter(
            (item) =>
              item.status === "confirmed" ||
              Date.parse(item.updatedAt) >= Date.parse(now) - PUBLIC_AGENDA_CANCELLATION_DAYS * 86400000,
          );
      // Keep the proven public route empty after tombstones expire; never restore authored fallback.
      return publicAgendaCalendarSchema.parse({
        basis: "approved_history",
        name: currentPublic ? (latestPublic.eventName ?? "Event agenda") : "Event calendar",
        timeZone: latestPublic.timeZone,
        agendaPath: currentPublic
          ? (agendaPath ??
            latestPublic.publicAgendaPath ??
            `/events/${encodeURIComponent(latestPublic.eventSlug)}/agenda/`)
          : (latestPublic.publicAgendaPath ?? `/events/${encodeURIComponent(latestPublic.eventSlug)}/agenda/`),
        entries: retained.sort(
          (a, b) => a.startAt.localeCompare(b.startAt) || a.occurrenceId.localeCompare(b.occurrenceId),
        ),
      });
    },
    publicSlug: () => latestPublic?.eventSlug,
  };
}
