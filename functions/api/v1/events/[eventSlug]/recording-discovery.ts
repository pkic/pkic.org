import {
  eventRecordingDiscoveryRouteSchema,
  eventRecordingMeetingLinkRouteSchema,
  eventRecordingMeetingsRouteSchema,
  eventRecordingProviderMeetingsRouteSchema,
} from "../../../../../assets/shared/schemas/event-recording-discovery-routes";
import type { AdminContext } from "../../../../_lib/db/context";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getRecordingConfiguration } from "../../../../_lib/services/event-recordings/configuration";
import {
  discoverEventRecordings,
  discoverRecordingProviderMeetings,
} from "../../../../_lib/services/event-recordings/discovery";
import { linkRecordingMeeting, listRecordingMeetings } from "../../../../_lib/services/event-recordings/meeting-links";
import { requireEventPermission } from "./authorization";

const providerDependencies = { configuration: getRecordingConfiguration, fetcher: fetch };
export function recordingProviderMeetingsRoute(dependencies = providerDependencies) {
  return openApiRoute(eventRecordingProviderMeetingsRouteSchema, async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(
      await discoverRecordingProviderMeetings(
        db,
        event.id,
        actor,
        data.query,
        dependencies.configuration(c.env),
        dependencies.fetcher,
      ),
    );
  });
}
export function recordingMeetingLinkRoute(dependencies = providerDependencies) {
  return openApiRoute(eventRecordingMeetingLinkRouteSchema, async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(
      await linkRecordingMeeting(
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
export function recordingDiscoveryRoute(dependencies = providerDependencies) {
  return openApiRoute(eventRecordingDiscoveryRouteSchema, async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(
      await discoverEventRecordings(
        db,
        event.id,
        actor,
        data.query,
        dependencies.configuration(c.env),
        dependencies.fetcher,
      ),
    );
  });
}
export const EventRecordingProviderMeetingsGet = recordingProviderMeetingsRoute();
export const EventRecordingMeetingLinkPost = recordingMeetingLinkRoute();
export const EventRecordingDiscoveryGet = recordingDiscoveryRoute();
export const EventRecordingMeetingsGet = openApiRoute(
  eventRecordingMeetingsRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    return jsonNoStore(await listRecordingMeetings(db, event.id, actor, data.query));
  },
);
