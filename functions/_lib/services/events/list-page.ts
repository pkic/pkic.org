import type { EventsListQuery } from "../../../../assets/shared/schemas/event-management";
import type { PreparedRequestViewerRead } from "../../auth/optional-request-viewer";
import { hasPermission } from "../../auth/permissions";
import { buildOffsetPageStatements, decodeOffsetPageResults, batchRows } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import {
  buildEventsPageQuery,
  buildManagedEventsPageQuery,
  isAudienceSortColumn,
  mapEventAudience,
  mapEventManagementSummary,
  buildEventRegistrationStatsQuery,
  type EventAudienceRow,
  type EventManagementRow,
  type EventStatsRow,
} from "./catalog";
import { prepareEventParticipation, decodeEventParticipation, type EventParticipationRow } from "./participation";
import { prepareViewerEventStates, decodeViewerEventStates, type EventViewerStateRow } from "./viewer-state";
import {
  prepareEventAudienceSponsors,
  decodeEventAudienceAccess,
  type EventAudienceSponsorRow,
} from "./scanner-access";
import { eventAudienceViewer } from "./visibility";

/** Page IDs, count and bounded enrichment use the same live authority snapshot as authentication. */
export async function readEventsListPage(
  db: DatabaseLike,
  query: EventsListQuery,
  auth: PreparedRequestViewerRead | null,
) {
  const userId = auth?.userId ?? null;
  // Permission metadata bounds the query; canonical live authority is resolved in this batch.
  const subject = auth?.permissionActor ?? null;
  const queryViewer = { userId, ...(subject ? { admin: subject } : {}) };
  const audienceQuery = buildEventsPageQuery(
    queryViewer,
    query.sort && !isAudienceSortColumn(query.sort) ? { ...query, sort: undefined } : query,
    true,
  );
  const managementQuery = subject ? buildManagedEventsPageQuery(queryViewer, query) : null;
  const audienceSelection = { pages: [audienceQuery] };
  const stats = managementQuery ? buildEventRegistrationStatsQuery({ pages: [managementQuery] }) : null;
  const authentication = auth?.statements ?? [];
  const loaded = await db.batch([
    ...authentication,
    ...buildOffsetPageStatements(db, audienceQuery),
    ...(managementQuery ? buildOffsetPageStatements(db, managementQuery) : []),
    // One page per statement: D1 refuses both authorized page queries in one statement.
    prepareEventParticipation(db, userId, audienceSelection),
    ...(managementQuery ? [prepareEventParticipation(db, userId, { pages: [managementQuery] })] : []),
    prepareViewerEventStates(db, userId, audienceSelection),
    prepareEventAudienceSponsors(db, queryViewer, audienceSelection),
    ...(stats ? [db.prepare(stats.sql).bind(...stats.bindings)] : []),
  ]);
  const resolved = auth ? await auth.decode(loaded.slice(0, authentication.length)) : null;
  const staff = resolved?.staff;
  const resources = loaded.slice(authentication.length);
  const audience = decodeOffsetPageResults<EventAudienceRow>(resources[0], resources[1]);
  const management = managementQuery ? decodeOffsetPageResults<EventManagementRow>(resources[2], resources[3]) : null;
  const pageCount = managementQuery ? 4 : 2;
  const participationCount = managementQuery ? 2 : 1;
  const participation = decodeEventParticipation(
    resources.slice(pageCount, pageCount + participationCount).flatMap(batchRows<EventParticipationRow>),
  );
  const offset = pageCount + participationCount;
  const viewerStates = decodeViewerEventStates(batchRows<EventViewerStateRow>(resources[offset]));
  const viewer = {
    ...eventAudienceViewer(resolved?.session ?? null),
    admin: staff,
    scannerGrants: staff?.grants ?? [],
  };
  if (management && staff && hasPermission(staff, "events:read")) {
    const counts = new Map(batchRows<EventStatsRow>(resources[offset + 2]).map((row) => [row.event_id, row]));
    return {
      events: management.rows.map((row) =>
        mapEventManagementSummary(row, counts.get(row.id), participation.get(row.id)),
      ),
      total: management.total,
    };
  }
  // Preserve the canonical refusal for management-only sort columns after session decoding.
  if (query.sort && !isAudienceSortColumn(query.sort)) buildEventsPageQuery(viewer, query);
  const access = decodeEventAudienceAccess(
    viewer,
    audience.rows.map((row) => row.id),
    batchRows<EventAudienceSponsorRow>(resources[offset + 1]),
  );
  return {
    events: audience.rows.map((row) => ({
      ...mapEventAudience(row, viewerStates.get(row.id) ?? null, access.get(row.id)),
      participation: participation.get(row.id),
    })),
    total: audience.total,
  };
}
