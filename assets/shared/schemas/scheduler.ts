import { z } from "zod";
import { jsonErrorResponse, successResponseSchema, trimmedString, utcInstantSchema } from "./api-common";

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

export const schedulerJobsListResponseSchema = z.object({ jobs: z.array(scheduledJobSchema).max(200) });

export const schedulerJobParamsSchema = z.object({ jobKey: z.string().trim().min(1).max(80) });

export const schedulerJobRunCreateSchema = z.object({}).default({});
export const schedulerJobRunResponseSchema = successResponseSchema.extend({
  jobKey: z.string(),
  status: scheduledJobStatusSchema,
  durationMs: z.number().int().nonnegative(),
});

export const schedulerJobPauseSchema = z.object({ reason: trimmedString(3, 500) });
export const schedulerJobStateResponseSchema = successResponseSchema.extend({ job: scheduledJobSchema });

export const schedulerJobsListRouteSchema = {
  tags: ["Scheduler"],
  "x-pkic-auth": { required: true, scopes: ["scheduler:read"] },
  summary: "List scheduled jobs",
  description:
    "Returns every recurring job with its cadence, next wake, and outcome history. `lastSuccessAt` is reported separately from `lastRunAt` so a job that runs often but last succeeded days ago is visible rather than hidden behind one timestamp.",
  responses: {
    "200": {
      description: "Scheduled job registry.",
      content: { "application/json": { schema: schedulerJobsListResponseSchema } },
    },
    "401": jsonErrorResponse("Staff session required."),
    "403": jsonErrorResponse("Insufficient permission to read the scheduler."),
  },
};

export const schedulerJobRunCreateRouteSchema = {
  tags: ["Scheduler"],
  "x-pkic-auth": { required: true, scopes: ["scheduler:manage"] },
  summary: "Run a scheduled job now",
  description:
    "Runs one job immediately, outside its interval. Requires `scheduler:manage` AND every grant the job's own domain requires, so triggering through the scheduler cannot do what the caller could not do directly. The run takes the same lease and D1 query budget as a scheduled pass.",
  request: {
    params: schedulerJobParamsSchema,
    body: { required: false, content: { "application/json": { schema: schedulerJobRunCreateSchema } } },
  },
  responses: {
    "200": {
      description: "Job run result.",
      content: { "application/json": { schema: schedulerJobRunResponseSchema } },
    },
    "401": jsonErrorResponse("Staff session required."),
    "403": jsonErrorResponse("Insufficient permission to run this job."),
    "404": jsonErrorResponse("Unknown job."),
    "409": jsonErrorResponse("The job is paused or already running."),
  },
};

export const schedulerJobPauseRouteSchema = {
  tags: ["Scheduler"],
  "x-pkic-auth": { required: true, scopes: ["scheduler:manage"] },
  summary: "Pause a scheduled job",
  description:
    "Stops the dispatcher selecting this job until it is resumed. Because the dispatcher re-derives due work from domain state on every pass, a pause loses no work — the job simply finds it again on resume. A reason is required so a pause is attributable.",
  request: {
    params: schedulerJobParamsSchema,
    body: { required: true, content: { "application/json": { schema: schedulerJobPauseSchema } } },
  },
  responses: {
    "200": {
      description: "Job paused.",
      content: { "application/json": { schema: schedulerJobStateResponseSchema } },
    },
    "401": jsonErrorResponse("Staff session required."),
    "403": jsonErrorResponse("Insufficient permission to manage the scheduler."),
    "404": jsonErrorResponse("Unknown job."),
  },
};

export const schedulerJobResumeRouteSchema = {
  ...schedulerJobPauseRouteSchema,
  summary: "Resume a paused scheduled job",
  description:
    "Returns the job to the dispatcher. Any work that accumulated while it was paused is found by the next pass, because due work is derived from domain state rather than queued.",
  request: { params: schedulerJobParamsSchema },
};
