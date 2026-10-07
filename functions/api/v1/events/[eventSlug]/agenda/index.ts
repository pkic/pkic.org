import { listSessionMaterialVersions } from "../../../../../_lib/services/event-agenda/history";
import { updateAgendaRoom } from "../../../../../_lib/services/event-agenda/rooms";
import { saveSessionHistory, listSessionAppearanceChoices } from "../../../../../_lib/services/event-agenda/history";
import { importAgenda } from "../../../../../_lib/services/event-agenda/import";
import { guardPermissionDatabase } from "../../../../../_lib/auth/permissions";
import type { AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getAgenda, listAgendaOccurrences, listAgendaPeople } from "../../../../../_lib/services/event-agenda/read";
import {
  saveAgendaSettings,
  createAgendaRoom,
  createAgendaOccurrence,
  patchAgendaOccurrence,
  saveAgendaStaffing,
  allocateStaffing,
  publishAgenda,
} from "../../../../../_lib/services/event-agenda/mutations";
import * as contracts from "../../../../../../assets/shared/schemas/route-contracts-event-agenda";
import { requireEventPermission } from "../authorization";

export async function authorize(c: AdminContext, slug: string, write: boolean) {
  const context = await requireEventPermission(c, slug, write ? "agenda:write" : "agenda:read");
  return {
    ...context,
    db: guardPermissionDatabase(
      context.db,
      context.actor,
      [{ permission: write ? "agenda:write" : "agenda:read", context: context.context }],
      () => new AppError(409, "AGENDA_AUTHORIZATION_CHANGED", "Agenda permission changed"),
    ),
  };
}
export const AgendaGet = openApiRoute(contracts.agendaGetRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await getAgenda(db, event.id, event.slug));
});
export const AgendaOccurrencesGet = openApiRoute(contracts.agendaOccurrencesGetRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await listAgendaOccurrences(db, event.id, data.query));
});
export const AgendaRoomCreate = openApiRoute(contracts.agendaRoomCreateRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await createAgendaRoom(db, event.id, event.slug, data.body, actor.id));
});
export const AgendaOccurrenceCreate = openApiRoute(contracts.agendaOccurrenceCreateRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await createAgendaOccurrence(db, event.id, event.slug, data.body, actor.id));
});
export const AgendaOccurrencePatch = openApiRoute(contracts.agendaOccurrencePatchRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await patchAgendaOccurrence(db, event.id, event.slug, data.params.occurrenceId, data.body, actor.id));
});

export const AgendaStaffing = openApiRoute(contracts.agendaStaffingRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await saveAgendaStaffing(db, event.id, event.slug, data.body, actor.id));
});
export const AgendaAllocation = openApiRoute(contracts.agendaAllocationRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(
    await allocateStaffing(
      db,
      event.id,
      event.slug,
      data.body.expectedRevision,
      data.body.seed,
      data.body.strategy,
      actor.id,
      data.body.shiftIds,
    ),
  );
});
export const AgendaPublication = openApiRoute(contracts.agendaPublicationRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await publishAgenda(db, event.id, event.slug, data.body.expectedRevision, actor.id));
});

export const AgendaImport = openApiRoute(contracts.agendaImportRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await importAgenda(db, event.id, event.slug, data.body, actor.id));
});

export const AgendaPeopleGet = openApiRoute(contracts.agendaPeopleRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, true);
  return json(await listAgendaPeople(db, event.id, data.query));
});

export const AgendaSettingsPost = openApiRoute(contracts.agendaSettingsRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await saveAgendaSettings(db, event.id, event.slug, data.body, actor.id));
});

export const AgendaSessionHistory = openApiRoute(contracts.agendaSessionHistoryRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(
    await saveSessionHistory(
      db,
      event.id,
      event.slug,
      data.params.occurrenceId,
      data.body.expectedRevision,
      data.body.history,
      actor.id,
      c.env.SPEAKER_UPLOADS_BUCKET,
    ),
  );
});

export const AgendaRoomUpdate = openApiRoute(contracts.agendaRoomUpdateRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await updateAgendaRoom(db, event.id, event.slug, data.params.roomId, data.body, actor.id));
});

export const AgendaHistoryIdentitiesGet = openApiRoute(
  contracts.agendaHistoryIdentitiesRouteSchema,
  async (c, data) => {
    const { db, event } = await authorize(c, data.params.eventSlug, false);
    return json(await listSessionAppearanceChoices(db, event.id, data.params.occurrenceId, data.query));
  },
);

export const AgendaHistoryMaterialsGet = openApiRoute(contracts.agendaHistoryMaterialsRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await listSessionMaterialVersions(db, event.id, data.params.occurrenceId, data.query));
});
