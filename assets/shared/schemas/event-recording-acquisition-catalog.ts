import { z } from "zod";
import { eventSlugParamsSchema } from "./api-common";
import {
  eventRecordingAcquisitionSchema,
  eventRecordingAcquisitionStatusSchema,
  eventRecordingSourceSchema,
} from "./event-recordings";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, ok, requiresPermissions } from "./route-contract";

export const eventRecordingAcquisitionsQuerySchema = listQuerySchema(["createdAt", "status", "nextAttemptAt"] as const)
  .extend({ status: eventRecordingAcquisitionStatusSchema.optional() })
  .strict();
export type EventRecordingAcquisitionsQuery = z.infer<typeof eventRecordingAcquisitionsQuerySchema>;
export const eventRecordingAcquisitionsResponseSchema = paginatedResponseSchema(
  "acquisitions",
  eventRecordingAcquisitionSchema,
);

const params = eventSlugParamsSchema.extend({ sourceId: eventRecordingSourceSchema.shape.id });
const errors = authErrors({ badRequest: "Invalid recording query", notFound: "Event or recording source not found" });

export const eventRecordingSourceDetailRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event recordings"],
  summary: "Read event-owned recording source metadata",
  request: { params },
  responses: { ...ok("Recording source metadata", eventRecordingSourceSchema), ...errors },
};
export const eventRecordingAcquisitionsRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event recordings"],
  summary: "List an event-owned source's recording acquisitions",
  request: { params, query: eventRecordingAcquisitionsQuerySchema },
  responses: { ...ok("Recording acquisition catalog", eventRecordingAcquisitionsResponseSchema), ...errors },
};
