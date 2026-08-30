import { z } from "zod";
import { successResponseSchema, trimmedString, utcInstantSchema } from "./api-common";
import { authErrors, ok, requiresPermissions } from "./route-contract";

/**
 * The scheduler is the mechanism; a scheduled job is the resource it manages.
 * Jobs are nested under it so `/api/v1/jobs` stays available for unrelated
 * postings, and so neither segment is a compound name.
 */
export const SCHEDULED_JOB_STATUSES = ["succeeded", "failed", "abandoned", "budget_exhausted"] as const;
export const scheduledJobStatusSchema = z.enum(SCHEDULED_JOB_STATUSES);

export const scheduledJobSchema = z.object({
  jobKey: z.string().min(1).max(80),
  intervalSeconds: z.number().int().positive(),
  nextRunAt: utcInstantSchema,
  wakeRequested: z.boolean(),

  lastRunAt: utcInstantSchema.nullable(),
  /** Deliberately separate from lastRunAt: a job can run often and succeed rarely. */
  lastSuccessAt: utcInstantSchema.nullable(),
  lastStatus: scheduledJobStatusSchema.nullable(),
  lastError: z.string().nullable(),
  lastDurationMs: z.number().int().nonnegative().nullable(),

  consecutiveFailures: z.number().int().nonnegative(),
  /** Counted apart from failures: dying mid-run is a different defect from raising. */
  consecutiveAbandoned: z.number().int().nonnegative(),

  /** Present only while a run holds the lease. */
  runningSince: utcInstantSchema.nullable(),
  leaseExpiresAt: utcInstantSchema.nullable(),

  pausedAt: utcInstantSchema.nullable(),
  pausedReason: z.string().nullable(),

  /** True when a claimed run has outlived its lease and is awaiting reaping. */
  leaseExpired: z.boolean(),
});
export type ScheduledJob = z.infer<typeof scheduledJobSchema>;

export const scheduledJobCapabilitiesSchema = z.object({
  run: z.boolean(),
  manageState: z.boolean(),
});
export const scheduledJobResourceSchema = scheduledJobSchema.extend({
  capabilities: scheduledJobCapabilitiesSchema,
});
export type ScheduledJobResource = z.infer<typeof scheduledJobResourceSchema>;

export const schedulerJobsListResponseSchema = z.object({ jobs: z.array(scheduledJobResourceSchema).max(200) });

export const schedulerJobParamsSchema = z.object({ jobKey: z.string().trim().min(1).max(80) });

export const schedulerJobRunCreateSchema = z.object({}).default({});
export const schedulerJobRunResponseSchema = successResponseSchema.extend({
  jobKey: z.string(),
  status: scheduledJobStatusSchema,
  durationMs: z.number().int().nonnegative(),
});

export const schedulerJobStateUpdateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("paused"), reason: trimmedString(3, 500) }),
  z.object({ state: z.literal("active") }),
]);
export type ScheduledJobStateUpdate = z.infer<typeof schedulerJobStateUpdateSchema>;
export const schedulerJobStateResponseSchema = successResponseSchema.extend({ job: scheduledJobResourceSchema });

export const schedulerJobsListRouteSchema = {
  tags: ["Scheduler"],
  ...requiresPermissions("scheduler:read"),
  summary: "List scheduled jobs",
  description:
    "Returns every recurring job with its cadence, next wake, and outcome history. `lastSuccessAt` is reported separately from `lastRunAt` so a job that runs often but last succeeded days ago is visible rather than hidden behind one timestamp.",
  responses: {
    ...ok("Scheduled job registry.", schedulerJobsListResponseSchema),
    ...authErrors({ forbidden: "Requires scheduler:read." }),
  },
};

export const schedulerJobRunCreateRouteSchema = {
  tags: ["Scheduler"],
  ...requiresPermissions("scheduler:read", "scheduler:manage"),
  summary: "Run a scheduled job now",
  description:
    "Runs one job immediately, outside its interval. Requires every grant the job's own domain requires in addition to `scheduler:manage`, so triggering through the scheduler cannot do what the caller could not do directly. The run takes the same lease and D1 query budget as a scheduled pass.",
  request: {
    params: schedulerJobParamsSchema,
    body: { required: false, content: { "application/json": { schema: schedulerJobRunCreateSchema } } },
  },
  responses: {
    ...ok("Job run result.", schedulerJobRunResponseSchema),
    ...authErrors({
      forbidden: "Requires scheduler:manage and the job's own domain permissions.",
      notFound: "Unknown job.",
      conflict: "The job is paused or already running.",
    }),
  },
};

export const schedulerJobStateUpdateRouteSchema = {
  tags: ["Scheduler"],
  ...requiresPermissions("scheduler:read", "scheduler:manage"),
  summary: "Update scheduled job state",
  description:
    "Pauses or resumes one scheduled job. A pause stops future dispatcher selection without cancelling a run that already holds the lease. Because each job re-derives due work from domain state, accumulated work is found after resume. A pause reason is required for attribution.",
  request: {
    params: schedulerJobParamsSchema,
    body: { required: true, content: { "application/json": { schema: schedulerJobStateUpdateSchema } } },
  },
  responses: {
    ...ok("Updated scheduled job.", schedulerJobStateResponseSchema),
    ...authErrors({
      forbidden: "Requires scheduler:manage.",
      notFound: "Unknown job.",
      conflict: "The job state or scheduler authorization changed while the update was being saved.",
    }),
  },
};
