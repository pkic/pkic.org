import { z } from "zod";
function normalizeSourceInstants(value) {
  if (Array.isArray(value)) return value.map(normalizeSourceInstants);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key.endsWith("_at") &&
        typeof item === "string" &&
        /^\d{4}-\d{2}-\d{2}T/.test(item) &&
        Number.isFinite(Date.parse(item))
          ? new Date(item).toISOString()
          : normalizeSourceInstants(item),
      ]),
    );
  return value;
}

const githubTimeSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const githubActorSchema = z.object({ login: z.string() }).nullable();
export const githubApplicationIssueSchema = z.preprocess(
  normalizeSourceInstants,
  z.looseObject({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    html_url: z.url(),
    title: z.string(),
    body: z.string().nullable(),
    state: z.enum(["open", "closed"]),
    state_reason: z.string().nullable(),
    labels: z.array(z.object({ id: z.number().int(), name: z.string() })),
    created_at: githubTimeSchema,
    updated_at: githubTimeSchema,
    closed_at: githubTimeSchema.nullable(),
    pull_request: z.unknown().optional(),
  }),
);
const eventShape = {
  event: z.string().optional(),
  body: z.string().nullable().optional(),
  created_at: githubTimeSchema,
  actor: githubActorSchema.optional(),
  user: githubActorSchema.optional(),
};
export const githubApplicationEventSchema = z.preprocess(
  normalizeSourceInstants,
  z.looseObject({ id: z.number().int(), ...eventShape }),
);
/** Timeline rows such as cross-references have no numeric ID. */
export const githubApplicationTimelineEventSchema = z.preprocess(
  normalizeSourceInstants,
  z.looseObject({ id: z.number().int().optional(), ...eventShape }),
);
export const githubApplicationEvidenceSchema = z.object({
  repository: z.literal("pkic/members"),
  labelId: z.number().int().positive(),
  issue: githubApplicationIssueSchema,
  comments: z.array(githubApplicationEventSchema),
  timeline: z.array(githubApplicationTimelineEventSchema),
});
