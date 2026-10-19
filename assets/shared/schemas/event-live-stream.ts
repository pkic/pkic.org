/**
 * Live streams of an event's locations: what organizers configure per location (and per event day), and the
 * virtual room's read of them. A stream names its provider so another player (Cloudflare Stream, RealtimeKit)
 * can join the union later; only YouTube's privacy-enhanced player exists today.
 */
import { z } from "zod";
import { YOUTUBE_VIDEO_ID_PATTERN, youtubeVideoId } from "../youtube-video";
import { eventSlugParamsSchema } from "./api-common";
import { eventDayDateSchema } from "./event-read-models";
import { timeZoneSchema } from "./event-series";
import { authErrors, ok, requiresPermissions, requiresSession } from "./route-contract";

export const LIVE_STREAM_PROVIDERS = ["youtube"] as const;
export const liveStreamProviderSchema = z.enum(LIVE_STREAM_PROVIDERS);
export type LiveStreamProvider = z.infer<typeof liveStreamProviderSchema>;

const agendaRoomIdSchema = z.string().min(1).max(200);
export const youtubeVideoIdSchema = z.string().regex(YOUTUBE_VIDEO_ID_PATTERN, "Enter a YouTube video ID.");

/** A configured stream as stored and returned: its provider and that provider's own reference. */
export const liveStreamSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("youtube"), videoId: youtubeVideoIdSchema }),
]);
export type LiveStream = z.infer<typeof liveStreamSchema>;

/**
 * What an organizer types: a YouTube address (watch, live, share or embed link) or the bare video ID.
 * Parsing keeps only the ID, so the same contract accepts its own output when the form is sent again.
 */
export const youtubeStreamInputSchema = z
  .string()
  .trim()
  .min(1, "Enter a YouTube link or video ID.")
  .max(500, "Enter a YouTube link or video ID.")
  .transform((value, context) => {
    const videoId = youtubeVideoId(value);
    if (videoId) return videoId;
    context.addIssue({
      code: "custom",
      message: "Enter a YouTube link, such as https://www.youtube.com/live/…, or its 11-character video ID.",
    });
    return z.NEVER;
  });

/** Days on which a location streams something other than its usual stream. */
const dayOverridesSchema = <Item extends z.ZodType<{ dayDate: string }>>(item: Item) =>
  z
    .array(item)
    .max(31)
    .refine((days) => new Set(days.map((day) => day.dayDate)).size === days.length, "Set each day once");

export const locationLiveStreamUpdateSchema = z.object({
  /** The location's usual stream, or null for none. */
  videoId: youtubeStreamInputSchema.nullable(),
  /** Per-day replacements; a day not listed follows the usual stream. */
  days: dayOverridesSchema(z.object({ dayDate: eventDayDateSchema, videoId: youtubeStreamInputSchema })).default([]),
});
export type LocationLiveStreamUpdate = z.infer<typeof locationLiveStreamUpdateSchema>;

export const locationLiveStreamDaySchema = z.object({ dayDate: eventDayDateSchema, stream: liveStreamSchema });

/** One location's stream configuration, with the event's days an override may name. */
export const locationLiveStreamResponseSchema = z.object({
  roomId: agendaRoomIdSchema,
  roomName: z.string(),
  stream: liveStreamSchema.nullable(),
  days: dayOverridesSchema(locationLiveStreamDaySchema),
  eventDays: z.array(eventDayDateSchema).max(31),
  timeZone: timeZoneSchema,
});
export type LocationLiveStreamResponse = z.infer<typeof locationLiveStreamResponseSchema>;

/** A published location the viewer may watch, with its usual stream and its per-day replacements. */
export const virtualRoomLocationSchema = z.object({
  id: agendaRoomIdSchema,
  name: z.string(),
  stream: liveStreamSchema.nullable(),
  days: dayOverridesSchema(locationLiveStreamDaySchema),
});
export type VirtualRoomLocation = z.infer<typeof virtualRoomLocationSchema>;

/** Every streamed location of the event's published agenda, in the agenda's location order. */
export const virtualRoomResponseSchema = z.object({
  timeZone: timeZoneSchema,
  locations: z.array(virtualRoomLocationSchema).max(100),
});
export type VirtualRoomResponse = z.infer<typeof virtualRoomResponseSchema>;

/** The stream a location shows on one event day: that day's replacement, else its usual stream. */
export function locationStreamOn(location: Pick<VirtualRoomLocation, "stream" | "days">, dayDate: string) {
  return location.days.find((day) => day.dayDate === dayDate)?.stream ?? location.stream;
}

const roomParamsSchema = eventSlugParamsSchema.extend({ roomId: agendaRoomIdSchema });
const tags = ["Event agenda"];

export const locationLiveStreamGetRouteSchema = {
  tags,
  summary: "Read a location's live stream configuration",
  request: { params: roomParamsSchema },
  responses: {
    ...ok("Location live stream", locationLiveStreamResponseSchema),
    ...authErrors({ notFound: "Event or location not found" }),
  },
  ...requiresPermissions("agenda:read"),
};

export const locationLiveStreamPutRouteSchema = {
  tags,
  summary: "Replace a location's live stream configuration",
  request: {
    params: roomParamsSchema,
    body: { content: { "application/json": { schema: locationLiveStreamUpdateSchema } } },
  },
  responses: {
    ...ok("Location live stream", locationLiveStreamResponseSchema),
    ...authErrors({ badRequest: "Invalid stream or event day", notFound: "Event or location not found" }),
  },
  ...requiresPermissions("agenda:write"),
};

export const virtualRoomGetRouteSchema = {
  ...requiresSession(),
  tags,
  summary: "Read the event's live streams for a registered attendee or event staff",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...ok("Streamed locations of the published agenda", virtualRoomResponseSchema),
    ...authErrors({
      forbidden: "A registration for this event or event staff access is required",
      notFound: "Event not found",
    }),
  },
};
