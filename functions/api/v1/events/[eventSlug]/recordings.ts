import {
  eventRecordingSourceDetailRouteSchema,
  eventRecordingAcquisitionsRouteSchema,
} from "../../../../../assets/shared/schemas/event-recording-acquisition-catalog";
import {
  eventRecordingAcquireRouteSchema,
  eventRecordingAcquisitionRouteSchema,
  eventRecordingSourceBindRouteSchema,
  eventRecordingSourceRefreshRouteSchema,
  eventRecordingSourcesRouteSchema,
  eventRecordingVersionsRouteSchema,
} from "../../../../../assets/shared/schemas/event-recording-routes";
import type { AdminContext } from "../../../../_lib/db/context";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  getRecordingAcquisition,
  requestRecordingAcquisition,
} from "../../../../_lib/services/event-recordings/acquisitions";
import { getRecordingConfiguration } from "../../../../_lib/services/event-recordings/configuration";
import { refreshRecordingSource } from "../../../../_lib/services/event-recordings/source-refresh";
import {
  getRecordingSource,
  listSourceRecordingAcquisitions,
} from "../../../../_lib/services/event-recordings/source-detail";
import {
  bindRecordingSource,
  recordingSources,
  recordingVersions,
} from "../../../../_lib/services/event-recordings/sources";
import { requireEventPermission } from "./authorization";

/** Only provider transport and private configuration vary in mounted route tests. */
export function recordingSourceBindRoute(dependencies = { configuration: getRecordingConfiguration, fetcher: fetch }) {
  return openApiRoute(eventRecordingSourceBindRouteSchema, async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(
      await bindRecordingSource(
        db,
        event.id,
        actor,
        data.body,
        dependencies.configuration(c.env),
        dependencies.fetcher,
      ),
    );
  });
}
export const EventRecordingSourceBindPost = recordingSourceBindRoute();

export function recordingSourceRefreshRoute(
  dependencies = { configuration: getRecordingConfiguration, fetcher: fetch },
) {
  return openApiRoute(eventRecordingSourceRefreshRouteSchema, async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(
      await refreshRecordingSource(
        db,
        event.id,
        data.params.sourceId,
        actor,
        data.body,
        dependencies.configuration(c.env),
        dependencies.fetcher,
      ),
    );
  });
}
export const EventRecordingSourceRefreshPost = recordingSourceRefreshRoute();

export const EventRecordingSourcesGet = openApiRoute(
  eventRecordingSourcesRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(await recordingSources(db, event.id, actor, data.query));
  },
);

export const EventRecordingSourceGet = openApiRoute(
  eventRecordingSourceDetailRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(await getRecordingSource(db, event.id, data.params.sourceId, actor));
  },
);

export const EventRecordingAcquisitionsGet = openApiRoute(
  eventRecordingAcquisitionsRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(await listSourceRecordingAcquisitions(db, event.id, data.params.sourceId, actor, data.query));
  },
);

export const EventRecordingVersionsGet = openApiRoute(
  eventRecordingVersionsRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(await recordingVersions(db, event.id, actor, data.query));
  },
);

export const EventRecordingAcquirePost = openApiRoute(
  eventRecordingAcquireRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(await requestRecordingAcquisition(db, event.id, data.params.sourceId, actor, data.body));
  },
);

export const EventRecordingAcquisitionGet = openApiRoute(
  eventRecordingAcquisitionRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(
      await getRecordingAcquisition(db, event.id, data.params.sourceId, data.params.acquisitionId, actor),
    );
  },
);
