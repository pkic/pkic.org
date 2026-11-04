import type { EventSettingsUpdateInput } from "../../../../assets/shared/schemas/event-management";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure } from "../audit";
import { readEventAdminResource } from "./authorized-context";
import { eventManagementCapabilities } from "./capabilities";
import { decodeEventDetail, prepareEventDetail, type EventDetailRow } from "./detail";
import {
  assertDirectEventConfiguration,
  prepareDirectEventConfigurationGuard,
  throwEventConfigurationConflict,
} from "./direct-configuration";
import { prepareEventFormSettingsRead } from "./direct-form-selection";
import { eventReadIdSql } from "./selection";
import { buildEventSettingsMutationStatements } from "./settings";

export async function updateDirectEventSettingsFromRequest(
  db: DatabaseLike,
  input: {
    eventSlug: string;
    request: Request;
    env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">;
    settings: EventSettingsUpdateInput;
    appBaseUrl: string;
    allowedHeroImageHosts?: string;
  },
) {
  const { expectedUpdatedAt, ...settings } = input.settings;
  const updatedAt = nowIso();
  const { actor, event, formStatements } = await readEventAdminResource(
    db,
    input.request,
    input.env,
    input.eventSlug,
    "events:write",
    (selection) => {
      const formRead = prepareEventFormSettingsRead(db, selection, settings, updatedAt);
      const eventId = eventReadIdSql(selection);
      return {
        statements: [
          db.prepare(`SELECT id FROM event_series WHERE event_id = ${eventId.sql} LIMIT 1`).bind(...eventId.bindings),
          ...formRead.statements,
        ],
        decode(results, event, actor) {
          assertDirectEventConfiguration(event, batchFirst<{ id: string }>(results[0])?.id ?? null);
          return { actor, event, formStatements: formRead.decode(results.slice(1), event.id) };
        },
      };
    },
  );
  const context = { type: "event", id: event.id };
  const response = prepareEventDetail(db, settings.slug ?? input.eventSlug);
  try {
    const results = await db.batch([
      ...buildEventSettingsMutationStatements(db, {
        event,
        actorId: actor.id,
        settings,
        appBaseUrl: input.appBaseUrl,
        allowedHeroImageHosts: input.allowedHeroImageHosts,
        expectedUpdatedAt,
        updatedAt,
        auditScope: context,
        authorizationGuards: [
          preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:write", context }]),
          prepareDirectEventConfigurationGuard(db, event.id),
        ],
      }),
      ...formStatements,
      response,
    ]);
    const row = batchFirst<EventDetailRow>(results[results.length - 1]);
    if (!row) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    return decodeEventDetail(row, eventManagementCapabilities(actor, context));
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_CHANGED", "The event changed; reload before saving");
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: events.slug")) {
      throw new AppError(409, "EVENT_SLUG_EXISTS", "An event with this slug already exists");
    }
    throwEventConfigurationConflict(error);
  }
}
