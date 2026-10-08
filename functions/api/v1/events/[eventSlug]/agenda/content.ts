import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { authorize } from "./index";
import { placeAgendaOccurrence } from "../../../../../_lib/services/event-agenda/occurrence-placements";
import {
  listAgendaContents,
  createAgendaContent,
  updateAgendaContent,
  placeAgendaContent,
  copyAgendaContent,
} from "../../../../../_lib/services/event-agenda/content-library";
import * as contracts from "../../../../../../assets/shared/schemas/route-contracts-agenda-content";
export const AgendaContentsGet = openApiRoute(contracts.agendaContentsGetRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await listAgendaContents(db, event.id, data.query));
});
export const AgendaContentCreate = openApiRoute(contracts.agendaContentCreateRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await createAgendaContent(db, event.id, data.body.expectedRevision, data.body.content, actor.id));
});
export const AgendaContentPatch = openApiRoute(contracts.agendaContentPatchRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(
    await updateAgendaContent(
      db,
      event.id,
      data.params.contentId,
      data.body.expectedRevision,
      data.body.content,
      data.body.resolveSourceReview,
      actor.id,
    ),
  );
});
export const AgendaContentPlace = openApiRoute(contracts.agendaContentPlaceRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(
    await placeAgendaContent(
      db,
      event.id,
      event.slug,
      data.params.contentId,
      data.body.expectedRevision,
      data.body.copyAsNew,
      actor.id,
    ),
  );
});
export const AgendaOccurrencePlace = openApiRoute(contracts.agendaOccurrencePlaceRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await placeAgendaOccurrence(db, event.id, event.slug, data.params.occurrenceId, data.body, actor.id));
});
export const AgendaContentCopy = openApiRoute(contracts.agendaContentCopyRouteSchema, async (c, data) => {
  const target = await authorize(c, data.params.eventSlug, true),
    source = await authorize(c, data.body.sourceEventSlug, false);
  return json(
    await copyAgendaContent(
      target.db,
      source.event.id,
      data.body.sourceContentId,
      target.event.id,
      data.body.expectedRevision,
      target.actor.id,
    ),
  );
});
