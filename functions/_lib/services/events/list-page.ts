import type { EventsListQuery } from "../../../../assets/shared/schemas/event-management";
import type { PreparedUserSessionRead } from "../../auth/user-session-request";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
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
  auth: PreparedUserSessionRead | null,
) {
  const userId = auth?.claims.sub ?? null;
  // This locally verified identity is only a SQL evidence subject. It supplies no grants.
  const subject = auth
    ? createUserBackedAuthAdmin({ id: auth.claims.sub, sessionId: auth.claims.sid, email: "" })
    : null;
  const queryViewer = { userId, ...(subject ? { admin: subject } : {}) };
  const audienceQuery = buildEventsPageQuery(
    queryViewer,
    query.sort && !isAudienceSortColumn(query.sort) ? { ...query, sort: undefined } : query,
    true,
  );
  const managementQuery = subject ? buildManagedEventsPageQuery(queryViewer, query) : null;
  const audienceSelection = { pages: [audienceQuery] };
  const selection = { pages: managementQuery ? [audienceQuery, managementQuery] : [audienceQuery] };
  const stats = managementQuery ? buildEventRegistrationStatsQuery({ pages: [managementQuery] }) : null;
  const authentication = auth?.statements ?? [];
  const loaded = await db.batch([
    ...authentication,
    ...buildOffsetPageStatements(db, audienceQuery),
    ...(managementQuery ? buildOffsetPageStatements(db, managementQuery) : []),
    prepareEventParticipation(db, userId, selection),
    prepareViewerEventStates(db, userId, audienceSelection),
    prepareEventAudienceSponsors(db, queryViewer, audienceSelection),
    ...(stats ? [db.prepare(stats.sql).bind(...stats.bindings)] : []),
  ]);
  const session = auth ? await auth.decode(loaded.slice(0, authentication.length)) : null;
  const resources = loaded.slice(authentication.length);
  const audience = decodeOffsetPageResults<EventAudienceRow>(resources[0], resources[1]);
  const management = managementQuery ? decodeOffsetPageResults<EventManagementRow>(resources[2], resources[3]) : null;
  const offset = managementQuery ? 4 : 2;
  const participation = decodeEventParticipation(batchRows<EventParticipationRow>(resources[offset]));
  const viewerStates = decodeViewerEventStates(batchRows<EventViewerStateRow>(resources[offset + 1]));
  const viewer = eventAudienceViewer(session);
  if (management && session?.staff && hasPermission(session.staff, "events:read")) {
    const counts = new Map(batchRows<EventStatsRow>(resources[offset + 3]).map((row) => [row.event_id, row]));
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
    batchRows<EventAudienceSponsorRow>(resources[offset + 2]),
  );
  return {
    events: audience.rows.map((row) => ({
      ...mapEventAudience(row, viewerStates.get(row.id) ?? null, access.get(row.id)),
      participation: participation.get(row.id),
    })),
    total: audience.total,
  };
}
