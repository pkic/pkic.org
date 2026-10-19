import { requireGroupResourceContext } from "../../../../group-resource-context";
import {
  listMeetingFormats,
  getPublishedMeetingAgenda,
} from "../../../../../../../_lib/services/event-series/agenda-catalog";
import {
  meetingFormatCatalogRouteSchema,
  publishedMeetingAgendaRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-meeting-agenda";
import {
  meetingAgendaGetRouteSchema,
  meetingAgendaSaveRouteSchema,
  meetingAgendaPublishRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-meeting-agenda";
import { meetingAgendaSchema } from "../../../../../../../../assets/shared/schemas/meeting-agenda";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import {
  getMeetingAgenda,
  saveMeetingAgenda,
  publishMeetingAgenda,
} from "../../../../../../../_lib/services/event-series/agenda";
export const GroupMeetingAgendaGet = openApiRoute(meetingAgendaGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(
    meetingAgendaSchema.parse(
      await getMeetingAgenda(db, actor, data.params.groupId, data.params.seriesId, data.query.occurrenceId ?? null),
    ),
  );
});
export const GroupMeetingAgendaSave = openApiRoute(meetingAgendaSaveRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(
    meetingAgendaSchema.parse(await saveMeetingAgenda(db, actor, data.params.groupId, data.params.seriesId, data.body)),
  );
});
export const GroupMeetingAgendaPublish = openApiRoute(
  meetingAgendaPublishRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    return json(
      meetingAgendaSchema.parse(
        await publishMeetingAgenda(
          db,
          actor,
          data.params.groupId,
          data.params.seriesId,
          data.params.occurrenceId,
          data.body.expectedRevision,
        ),
      ),
    );
  },
);

export const GroupMeetingFormatsGet = openApiRoute(meetingFormatCatalogRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  return json(await listMeetingFormats(db, viewer, group.id, data.query));
});
export const GroupPublishedMeetingAgendaGet = openApiRoute(
  publishedMeetingAgendaRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    return json(await getPublishedMeetingAgenda(db, viewer, group.id, data.params.seriesId, data.params.occurrenceId));
  },
);
