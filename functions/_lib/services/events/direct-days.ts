import type {
  EventDaysManagementReplaceInput,
  EventDaysManagementResponse,
} from "../../../../assets/shared/schemas/event-configuration";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { AppError } from "../../errors";
import { isAuditChangeGuardFailure } from "../audit";
import { listConfiguredEventDaysWithCounts } from "../event-days";
import { getEventBySlug } from "../events";
import { replaceConfiguredEventDays } from "./day-configuration";
import {
  prepareDirectEventConfigurationGuard,
  requireDirectEventConfiguration,
  throwEventConfigurationConflict,
} from "./direct-configuration";

export async function getDirectEventDays(db: DatabaseLike, eventSlug: string): Promise<EventDaysManagementResponse> {
  const event = await getEventBySlug(db, eventSlug);
  return {
    eventUpdatedAt: event.updated_at,
    days: await listConfiguredEventDaysWithCounts(db, event.id),
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
