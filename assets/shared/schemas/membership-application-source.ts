import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { APPLICATION_HISTORY_OUTCOMES } from "./member-applications";

export const historicalApplicationOutcomeSchema = z.enum(APPLICATION_HISTORY_OUTCOMES);
export const applicationSourceEventSchema = z.object({
  id: z.string(),
  kind: z.string(),
  author: z.string().nullable(),
  body: z.string().nullable(),
  createdAt: utcInstantSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export const applicationSourceSnapshotSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.object({ id: z.number().int(), name: z.string() })),
  state: z.enum(["open", "closed"]),
  closureReason: z.string().nullable(),
  events: z.array(applicationSourceEventSchema),
  attachmentUrls: z.array(z.string()),
  warnings: z.array(z.string()),
});
export const applicationSourceSchema = z.object({
  repository: z.string(),
  issueId: z.string(),
  issueNumber: z.number().int(),
  issueUrl: z.url(),
  importedAt: utcInstantSchema,
  activatedAt: utcInstantSchema.nullable(),
  historical: z.boolean(),
  snapshot: applicationSourceSnapshotSchema,
});
export type ApplicationSourceSnapshot = z.infer<typeof applicationSourceSnapshotSchema>;
