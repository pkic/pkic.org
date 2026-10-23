import type {
  EventDaysManagementReplaceInput,
  EventDaysManagementResponse,
} from "../../../../assets/shared/schemas/event-configuration";
import { preparePermissionsAuthorizationGuard, requirePermission } from "../../auth/permissions";
import type { DatabaseLike, UserBackedAuthAdmin, Env } from "../../types";
import { AppError } from "../../errors";
import { isAuditChangeGuardFailure } from "../audit";
import {
  prepareEventDays,
  prepareConfiguredEventDayCounts,
  decodeConfiguredEventDays,
  type EventDayRecord,
  type EventDayAttendanceCountRow,
} from "../event-days";
import { batchRows } from "../../db/pagination";
import { prepareEventAdminContext, readEventAdminContext } from "./authorized-context";
import { getEventBySlug } from "../events";
import { replaceConfiguredEventDays } from "./day-configuration";
import {
  prepareDirectEventConfigurationGuard,
  requireDirectEventConfiguration,
  throwEventConfigurationConflict,
} from "./direct-configuration";

export async function getDirectEventDays(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
): Promise<EventDaysManagementResponse> {
  const context = await prepareEventAdminContext(db, request, env, eventSlug);
  const reads = [prepareEventDays(db, { slug: eventSlug }), prepareConfiguredEventDayCounts(db, { slug: eventSlug })];
  const fallback = context ? null : await readEventAdminContext(db, request, env, eventSlug);
  const results = await db.batch([...(context?.statements ?? []), ...reads]);
  const { actor, event } = context ? await context.decode(results.slice(0, context.statements.length)) : fallback!;
  requirePermission(actor, "events:read", { type: "event", id: event.id });
  const [daysResult, countsResult] = results.slice(context?.statements.length ?? 0);
  return {
    eventUpdatedAt: event.updated_at,
    days: decodeConfiguredEventDays(
      batchRows<EventDayRecord>(daysResult),
      batchRows<EventDayAttendanceCountRow>(countsResult),
    ),
  };
}

export async function replaceDirectEventDays(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventSlug: string,
  input: EventDaysManagementReplaceInput,
): Promise<{ eventUpdatedAt: string; skipped: string[] }> {
  const event = await getEventBySlug(db, eventSlug);
  await requireDirectEventConfiguration(db, event);
  const context = { type: "event", id: event.id };
  try {
    const result = await replaceConfiguredEventDays(db, event, input.configuration, {
      actorId: actor.id,
      auditScope: context,
      expectedUpdatedAt: input.expectedUpdatedAt,
      authorizationGuards: [
        preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:write", context }]),
        prepareDirectEventConfigurationGuard(db, event.id),
      ],
    });
    return { eventUpdatedAt: result.updatedAt, skipped: result.skipped };
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_CHANGED", "The event changed; reload before saving");
    }
    throwEventConfigurationConflict(error);
  }
}
