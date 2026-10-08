import {
  EventRecordingSourceBindPost,
  EventRecordingSourceRefreshPost,
  EventRecordingSourcesGet,
  EventRecordingSourceGet,
  EventRecordingAcquisitionsGet,
  EventRecordingVersionsGet,
  EventRecordingAcquirePost,
  EventRecordingAcquisitionGet,
} from "./recordings";
import {
  EventRecordingProviderMeetingsGet,
  EventRecordingMeetingLinkPost,
  EventRecordingMeetingsGet,
  EventRecordingDiscoveryGet,
} from "./recording-discovery";

type RecordingRouter = Pick<typeof import("./router").openapi, "get" | "post">;

/** Preserve the event router's management middleware and canonical recording route order. */
export function registerRecordingRoutes(openapi: RecordingRouter): void {
  openapi.get("/recordings/meetings/discovery", EventRecordingProviderMeetingsGet);
  openapi.post("/recordings/meetings", EventRecordingMeetingLinkPost);
  openapi.get("/recordings/meetings", EventRecordingMeetingsGet);
  openapi.get("/recordings/discovery", EventRecordingDiscoveryGet);
  openapi.post("/recordings/sources", EventRecordingSourceBindPost);
  openapi.get("/recordings/sources", EventRecordingSourcesGet);
  openapi.get("/recordings/sources/:sourceId", EventRecordingSourceGet);
  openapi.post("/recordings/sources/:sourceId/refresh", EventRecordingSourceRefreshPost);
  openapi.get("/recordings/versions", EventRecordingVersionsGet);
  openapi.post("/recordings/sources/:sourceId/acquisitions", EventRecordingAcquirePost);
  openapi.get("/recordings/sources/:sourceId/acquisitions", EventRecordingAcquisitionsGet);
  openapi.get("/recordings/sources/:sourceId/acquisitions/:acquisitionId", EventRecordingAcquisitionGet);
}
