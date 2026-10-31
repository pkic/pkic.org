import { getUserSessionCookieToken, USER_SESSION_TOKEN_HEADER } from "../../auth/user-session";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { prepareUserBackedAdminFromRequest } from "../../auth/admin";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { userSessionActingIdentitySelection, userSessionMemberSelection } from "../../auth/identity-capacities";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { permissionAuthorizationEvidenceForResource, hasPermission } from "../../auth/permissions";
import { eventReadIdSql } from "../events/selection";
import { preparePromotionSourceRead } from "./promotion-source-read";
import { buildSpeakerPromotionSource } from "./promotion-speaker-source";
import { buildAttendeePromotionSource } from "./promotion-attendee-source";
import { AppError } from "../../errors";

/** JWT verification is local; live actor, event, source, metrics, and referral initialization share one snapshot. */
export async function preparePromotionRequestActor(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
) {
  if (
    request.headers.get("x-pkic-machine-auth") === "mcp" &&
    !request.headers.get(USER_SESSION_TOKEN_HEADER) &&
    !getUserSessionCookieToken(request)
  ) {
    const read = await prepareUserBackedAdminFromRequest(db, request, env);
    if (!read)
      throw new AppError(403, "USER_IDENTITY_REQUIRED", "A personal identity is required for promotion materials.");
    return {
      ...read,
      managementAuthorizationEvidence: read.authorizationEvidence,
      async decode(loaded: D1StatementResult[]) {
        return { userId: read.subjectId, staff: await read.decode(loaded) };
      },
    };
  }
  const read = await prepareUserSessionRequest(db, request, env);
  return {
    subjectId: read.claims.sub,
    sessionId: read.claims.sid,
    permissionActor: createUserBackedAuthAdmin({
      id: read.claims.sub,
      email: "",
      sessionId: read.claims.sid,
      scopes: [],
    }),
    authorizationEvidence: userSessionRequestAuthorizationEvidence(read.claims),
    managementAuthorizationEvidence: userSessionRequestAuthorizationEvidence(read.claims, true),
    memberSelection: userSessionMemberSelection(read.claims.sub, read.claims.iid),
    actingIdentitySelection: userSessionActingIdentitySelection(read.claims.sub, read.claims.iid),
    statements: read.statements,
    async decode(loaded: D1StatementResult[]) {
      const session = await read.decode(loaded);
      return { userId: session.identity.id, staff: session.staff };
    },
  };
}
export type PromotionRequestActor = Awaited<ReturnType<typeof preparePromotionRequestActor>>;
export function promotionRequestEntitlement(
  actor: PromotionRequestActor,
  eventSlug: string,
  occurrenceId: string | null,
): AuthorizationEvidence {
  const event = eventReadIdSql({ slug: eventSlug });
  if (!occurrenceId)
    return {
      sql: `SELECT 1 FROM registrations WHERE event_id=${event.sql} AND user_id=? AND status='registered'`,
      bindings: [...event.bindings, actor.subjectId],
    };
  const management = permissionAuthorizationEvidenceForResource(
    actor.permissionActor,
    "agenda:write",
    { type: "event", idSql: "(SELECT id FROM promotion_event)" },
    actor.memberSelection,
  );
  return {
    sql: `WITH promotion_event AS MATERIALIZED(SELECT id FROM events WHERE slug=?), promotion_management AS MATERIALIZED(${management.sql}), promotion_staff AS MATERIALIZED(${actor.managementAuthorizationEvidence.sql}) SELECT 1 FROM promotion_event target WHERE EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=target.id AND occurrence.id=? AND speaker.user_id=?) OR EXISTS(SELECT 1 FROM promotion_management,promotion_staff)`,
    bindings: [
      eventSlug,
      ...management.bindings,
      ...actor.managementAuthorizationEvidence.bindings,
      occurrenceId,
      actor.subjectId,
    ],
  };
}
export async function prepareOwnPromotionRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  occurrenceId: string | null,
  origin: string,
  initialize = false,
  preparedActor?: PromotionRequestActor,
  referralCondition?: AuthorizationEvidence,
) {
  const actor = preparedActor ?? (await preparePromotionRequestActor(db, request, env)),
    entitlement = promotionRequestEntitlement(actor, eventSlug, occurrenceId);
  const authority = {
    sql: `WITH promotion_authenticated AS MATERIALIZED(${actor.authorizationEvidence.sql}), promotion_entitled AS MATERIALIZED(${entitlement.sql}) SELECT 1 FROM promotion_authenticated,promotion_entitled LIMIT 1`,
    bindings: [...actor.authorizationEvidence.bindings, ...entitlement.bindings],
  };
  const source = preparePromotionSourceRead(
    db,
    { slug: eventSlug },
    actor.subjectId,
    occurrenceId,
    referralCondition
      ? {
          sql: `WITH source_authority AS MATERIALIZED(${authority.sql}), source_condition AS MATERIALIZED(${referralCondition.sql}) SELECT 1 FROM source_authority,source_condition LIMIT 1`,
          bindings: [...authority.bindings, ...referralCondition.bindings],
        }
      : authority,
    initialize,
  );
  async function decodeContext(loaded: D1StatementResult[]) {
    const current = await actor.decode(loaded.slice(0, actor.statements.length));
    const basis = await source.decode(loaded.slice(actor.statements.length));
    if (
      occurrenceId &&
      !basis.assigned &&
      !(current.staff && hasPermission(current.staff, "agenda:write", { type: "event", id: basis.visual.event.id }))
    )
      throw new AppError(
        403,
        "PROMOTION_SESSION_SCOPE",
        "Promotion materials are available only for your assigned sessions.",
      );
    if (!occurrenceId && !basis.registered)
      throw new AppError(
        403,
        "PROMOTION_REGISTRATION_REQUIRED",
        "Promotion materials are available to registered attendees.",
      );
    return { current, basis };
  }
  async function assemble(context: Awaited<ReturnType<typeof decodeContext>>) {
    const { current, basis } = context;
    const material = occurrenceId
      ? await buildSpeakerPromotionSource(basis, current.userId, origin)
      : await buildAttendeePromotionSource(basis, current.userId, origin);
    return { ...material, eventId: basis.visual.event.id, eventSlug: basis.visual.event.slug };
  }
  return {
    actor,
    authority,
    statements: [...actor.statements, ...source.statements],
    decodeContext,
    assemble,
    async decode(loaded: D1StatementResult[]) {
      return assemble(await decodeContext(loaded));
    },
  };
}
export async function readOwnPromotionRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  occurrenceId: string | null,
  origin: string,
  initialize = false,
) {
  const read = await prepareOwnPromotionRequest(db, request, env, eventSlug, occurrenceId, origin, initialize);
  return read.decode(await db.batch(read.statements));
}
