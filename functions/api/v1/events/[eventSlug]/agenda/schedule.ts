import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { authorize } from "./index";
import { reviewAgendaSchedule, applyAgendaSchedule } from "../../../../../_lib/services/event-agenda/schedule";
import {
  agendaScheduleReviewRouteSchema,
  agendaScheduleApplyRouteSchema,
} from "../../../../../../assets/shared/schemas/event-agenda-schedule";
export const AgendaScheduleReviewPost = openApiRoute(agendaScheduleReviewRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await reviewAgendaSchedule(db, event.id, event.slug, data.body, actor.id));
});
export const AgendaScheduleApplyPost = openApiRoute(agendaScheduleApplyRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await applyAgendaSchedule(db, event.id, event.slug, data.body, actor.id));
});
