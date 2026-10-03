import { z } from "zod";
import { httpOrSameOriginUrlSchema } from "./urls";
import { utcInstantSchema } from "./api-common";

const names = z
  .array(z.string())
  .nullish()
  .transform((value) => value ?? []);
const duration = z.number().nonnegative().optional();
const speaker = z.object({
  id: z.string().optional(),
  name: z.string(),
  title: z.string().nullish(),
  bio: z.string().nullish(),
  social: z
    .record(z.string(), z.string().nullable())
    .optional()
    .transform((value) =>
      value
        ? Object.fromEntries(
            Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : undefined,
    ),
  website: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  headshot: z.object({ x150: z.string(), x250: z.string(), x600: z.string() }).optional(),
});
const session = z.object({
  id: z.string().optional(),
  title: z
    .string()
    .nullish()
    .transform((value) => value ?? "Session"),
  description: z.string().nullish(),
  speakers: names,
  locations: names,
  durationMinutes: duration,
  endTime: z.string().optional(),
  endsAt: utcInstantSchema.optional(),
  rowSpan: z.number().int().positive().optional(),
  track: z.string().nullish(),
  presentation: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  youtube: z.string().optional(),
  recordingUrl: httpOrSameOriginUrlSchema.nullish().transform((value) => value ?? undefined),
});
const slot = z.object({
  time: z.string(),
  startsAt: utcInstantSchema.optional(),
  title: z.string().nullish(),
  sponsor: z.string().nullish(),
  noTransition: z.boolean().optional(),
  durationMinutes: duration,
  endTime: z.string().optional(),
  coveredLocations: names,
  sessions: z
    .array(session)
    .nullish()
    .transform((value) => value ?? []),
});

/** Public conference source and generated display data share one contract. */
export const conferenceProgramSourceSchema = z.object({
  name: z.string().default("Conference"),
  timezone: z.string(),
  draft: z.boolean().optional(),
  transitionMinutes: z.number().nonnegative().optional(),
  locations: z.record(z.string(), z.unknown()).default({}),
  speakers: z.array(speaker).default([]),
  agenda: z.record(z.string(), z.array(slot)).default({}),
});
export const conferenceProgramSchema = conferenceProgramSourceSchema.extend({
  agenda: z.record(z.string(), z.array(slot.extend({ startsAt: utcInstantSchema }))),
});
export type ConferenceProgram = z.infer<typeof conferenceProgramSchema>;
