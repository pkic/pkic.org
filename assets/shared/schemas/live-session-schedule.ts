import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { agendaOccurrenceSchema, agendaRoomSchema, agendaSpeakerSchema } from "./event-agenda";
import { timeZoneSchema } from "./event-series";
import { publicSessionPortraitUrlSchema } from "./event-session-history";
import { LIVE_GRAPHIC_THEME_DEFAULTS, liveGraphicThemeSchema } from "../live-graphic-theme";

export const LIVE_SCHEDULE_MAX_ROOMS = 20;
export const liveScheduleConfigSchema = z
  .object({
    scope: z.enum(["all-rooms", "this-room"]).default("all-rooms"),
    layout: z.enum(["cards", "list"]).default("cards"),
    theme: liveGraphicThemeSchema.default(LIVE_GRAPHIC_THEME_DEFAULTS.schedule),
  })
  .strict();
export type LiveScheduleConfig = z.infer<typeof liveScheduleConfigSchema>;
export const DEFAULT_LIVE_SCHEDULE_CONFIG: LiveScheduleConfig = {
  scope: "all-rooms",
  layout: "cards",
  theme: LIVE_GRAPHIC_THEME_DEFAULTS.schedule,
};
export const liveScheduleSpeakerSchema = z
  .object({
    name: agendaSpeakerSchema.shape.displayName.trim().min(1).max(300),
    moderator: z.boolean(),
    /** The headshot the public agenda shows for this credit; null when it shows none. */
    photoUrl: publicSessionPortraitUrlSchema.nullable().default(null),
  })
  .strict();
export const liveScheduleRoomSchema = z
  .object({
    roomId: agendaRoomSchema.shape.id,
    roomName: agendaRoomSchema.shape.name,
    /** The approved room order keeps its brand accent stable as other rooms finish. */
    roomIndex: z.number().int().nonnegative(),
    occurrenceId: agendaOccurrenceSchema.shape.id,
    title: agendaOccurrenceSchema.shape.title,
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
    speakers: z.array(liveScheduleSpeakerSchema).max(50),
  })
  .strict()
  .refine((value) => value.endAt > value.startAt);
export type LiveScheduleRoom = z.infer<typeof liveScheduleRoomSchema>;
export const liveScheduleProjectionSchema = z
  .object({
    config: liveScheduleConfigSchema,
    available: z.boolean(),
    timeZone: timeZoneSchema.nullable(),
    resolvedAt: utcInstantSchema,
    rooms: z.array(liveScheduleRoomSchema).max(LIVE_SCHEDULE_MAX_ROOMS),
  })
  .strict()
  .refine((value) => (value.available ? value.timeZone !== null : value.timeZone === null && value.rooms.length === 0))
  .refine((value) => new Set(value.rooms.map((room) => room.roomId)).size === value.rooms.length);
export type LiveScheduleProjection = z.infer<typeof liveScheduleProjectionSchema>;
/** Only a source choice crosses the command boundary; the approved agenda supplies all rendered data. */
export const liveScheduleCommandSchema = z
  .object({
    type: z.literal("stage.schedule"),
    schedule: liveScheduleConfigSchema.nullable(),
  })
  .strict();
export type LiveScheduleCommand = z.infer<typeof liveScheduleCommandSchema>;
