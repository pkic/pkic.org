import type { PreparedUserSessionRead } from "../../auth/user-session-request";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { hasPermission, permissionAuthorizationEvidenceForResource } from "../../auth/permissions";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { prepareEventDetail, decodeEventDetail, type EventDetailRow } from "./detail";
import { prepareEventAudienceDetail, mapEventAudience, type EventAudienceRow } from "./catalog";
import { prepareEventParticipation, decodeEventParticipation, type EventParticipationRow } from "./participation";
import { prepareViewerEventStates, decodeViewerEventStates, type EventViewerStateRow } from "./viewer-state";
import {
  prepareEventAudienceSponsors,
  decodeEventAudienceAccess,
  type EventAudienceSponsorRow,
} from "./scanner-access";
import { prepareEventProposalCall, type EventProposalCallRow } from "./proposal-call";
import { eventAudienceViewer } from "./visibility";
import { eventManagementCapabilities } from "./capabilities";

/**
 * JWT identity plans the queries; it never supplies permissions. Canonical live
 * session decoding and SQL row authority share the resource's one D1 snapshot.
 */
export async function readEventDetailPage(db: DatabaseLike, eventSlug: string, auth: PreparedUserSessionRead | null) {
  const userId = auth?.claims.sub ?? null;
  const subject = auth
    ? createUserBackedAuthAdmin({ id: auth.claims.sub, sessionId: auth.claims.sid, email: "" })
    : null;
  const queryViewer = { userId, ...(subject ? { admin: subject } : {}) };
  const selection = { slug: eventSlug };
  const managementAuthority = subject
    ? permissionAuthorizationEvidenceForResource(subject, "events:read", { type: "event", idSql: "event.id" })
    : { sql: "SELECT 1 WHERE 0", bindings: [] };
  const call = prepareEventProposalCall(db, selection);
  const authentication = auth?.statements ?? [];
  const loaded = await db.batch([
    ...authentication,
    prepareEventAudienceDetail(db, queryViewer, eventSlug),
    prepareEventDetail(db, eventSlug, managementAuthority),
    prepareEventParticipation(db, userId, selection),
    prepareViewerEventStates(db, userId, selection),
    prepareEventAudienceSponsors(db, queryViewer, selection),
    call.statement,
  ]);
  // No projection is released until the canonical session, idle, identity and sign-in policy passes.
  const session = auth ? await auth.decode(loaded.slice(0, authentication.length)) : null;
  const [audienceResult, managementResult, participationResult, viewerResult, sponsorsResult, callResult] =
    loaded.slice(authentication.length);
  const audience = batchFirst<EventAudienceRow>(audienceResult);
  const management = batchFirst<EventDetailRow>(managementResult);
  const row = audience ?? management;
  if (!row) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found or not visible to this caller");
  const viewer = eventAudienceViewer(session);
  const access = decodeEventAudienceAccess(viewer, [row.id], batchRows<EventAudienceSponsorRow>(sponsorsResult)).get(
    row.id,
  );
  const context = { type: "event", id: row.id };
  const event =
    management && session?.staff && hasPermission(session.staff, "events:read", context)
      ? decodeEventDetail(management, eventManagementCapabilities(session.staff, context), access?.scannerAccess)
      : audience
        ? mapEventAudience(
            audience,
            decodeViewerEventStates(batchRows<EventViewerStateRow>(viewerResult)).get(row.id) ?? null,
            access,
          )
        : null;
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found or not visible to this caller");
  return {
    ...event,
    proposalCall: call.decode(batchFirst<EventProposalCallRow>(callResult)),
    participation: userId
      ? decodeEventParticipation(batchRows<EventParticipationRow>(participationResult)).get(row.id)
      : undefined,
  };
}
