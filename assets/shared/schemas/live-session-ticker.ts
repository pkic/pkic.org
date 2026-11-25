import { publicPageSlugSchema } from "./public-page-slug";
import { z } from "zod";
import { validateOverlayTextTemplate } from "../overlay-text-template";
/** The most messages one ticker sequence holds. */
export const LIVE_TICKER_MESSAGES_MAX = 20;
/** The most rooms one ticker message names. */
export const LIVE_TICKER_ROOMS_MAX = 50;

export const liveTickerMessageSchema = z
  .object({
    id: z.string().min(1).max(80),
    prefix: z.string().trim().max(40),
    template: z.string().trim().min(1).max(500),
    condition: z.enum(["always", "near-session-end"]),
    /** The agenda rooms the message shows in; without any, it shows in every room. */
    roomIds: z
      .array(z.string().min(1).max(200))
      .max(LIVE_TICKER_ROOMS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, "Choose each room once.")
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const message = validateOverlayTextTemplate(value.template);
    if (message) ctx.addIssue({ code: "custom", path: ["template"], message });
  });
/**
 * How fast the ticker scrolls, in pixels of the 1920 × 1080 frame per second, whatever the length of its
 * messages: an operator's choice, read the same on every output. The default is slow enough to read a
 * message through once as it crosses the frame.
 */
export const LIVE_TICKER_SPEED = { min: 40, max: 200, step: 10, default: 90 } as const;
/** The speeds a ticker was saved with before it took pixels per second. */
const RETIRED_TICKER_SPEEDS: Record<string, number> = { slow: 60, normal: 90, fast: 130 };
export const liveTickerSpeedSchema = z
  .preprocess(
    // One saved with a named speed keeps its pace.
    (value) => RETIRED_TICKER_SPEEDS[String(value)] ?? value,
    z
      .number()
      .int()
      .min(LIVE_TICKER_SPEED.min, `Choose at least ${LIVE_TICKER_SPEED.min} px/s.`)
      .max(LIVE_TICKER_SPEED.max, `Choose at most ${LIVE_TICKER_SPEED.max} px/s.`)
      .multipleOf(LIVE_TICKER_SPEED.step, `Choose a speed in steps of ${LIVE_TICKER_SPEED.step} px/s.`),
  )
  // A ticker saved before the speed existed scrolls at the default.
  .default(LIVE_TICKER_SPEED.default);

export const liveTickerConfigSchema = z
  .object({
    style: z.enum(["gradient", "accent", "neutral"]),
    speed: liveTickerSpeedSchema,
    messages: z.array(liveTickerMessageSchema).min(1).max(LIVE_TICKER_MESSAGES_MAX),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.messages.map((message) => message.id)).size !== value.messages.length)
      ctx.addIssue({ code: "custom", path: ["messages"], message: "Choose each message once." });
  });
export type LiveTickerConfig = z.infer<typeof liveTickerConfigSchema>;
/** The settings of a resolved ticker, without the content the room resolved for them. */
export function liveTickerConfigOf(ticker: LiveTickerConfig): LiveTickerConfig {
  return { style: ticker.style, speed: ticker.speed, messages: ticker.messages };
}
export const liveTickerSegmentSchema = z
  .object({
    id: liveTickerMessageSchema.shape.id,
    prefix: liveTickerMessageSchema.shape.prefix,
    markdown: z.string().min(1).max(2000),
  })
  .strict();
export type LiveTickerSegment = z.infer<typeof liveTickerSegmentSchema>;
export const liveTickerSchema = liveTickerConfigSchema.safeExtend({
  segments: z.array(liveTickerSegmentSchema).max(LIVE_TICKER_MESSAGES_MAX),
});
export type LiveTicker = z.infer<typeof liveTickerSchema>;
export const liveTickerContextSchema = z
  .object({
    timeZone: z.string().min(1).max(100),
    sponsorGroups: z
      .array(
        z
          .object({
            key: publicPageSlugSchema,
            tier: z.string().max(100),
            names: z.array(z.string().max(300)).max(200),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sponsorGroups.reduce((sum, group) => sum + group.names.length, 0) > 200)
      ctx.addIssue({
        code: "custom",
        path: ["sponsorGroups"],
        message: "Use at most two hundred public sponsor names.",
      });
  });
export type LiveTickerContext = z.infer<typeof liveTickerContextSchema>;
export const DEFAULT_LIVE_TICKER_CONTEXT: LiveTickerContext = { timeZone: "UTC", sponsorGroups: [] };
export const DEFAULT_LIVE_TICKER_CONFIG: LiveTickerConfig = {
  style: "gradient",
  speed: LIVE_TICKER_SPEED.default,
  messages: [
    { id: "greeting", prefix: "Welcome", template: "{{greeting}}", condition: "always" },
    {
      id: "next",
      prefix: "Next",
      template: "{{#next.title}}**{{next.title}}** · {{next.time}} · {{next.in}}{{/next.title}}",
      condition: "near-session-end",
    },
    { id: "rooms", prefix: "Other rooms", template: "{{other_rooms.next}}", condition: "always" },
    {
      id: "sponsors",
      prefix: "Thank you",
      template: "{{#sponsors.tiers}}**{{tier}}**: {{#names}}{{.}} · {{/names}}{{/sponsors.tiers}}",
      condition: "always",
    },
    {
      id: "questions",
      prefix: "Questions",
      template: "Have a question? Submit it in the event app.",
      condition: "always",
    },
  ],
};
/** One-time storage normalization only; HTTP accepts exclusively the sequence config above. */
export function readStoredLiveTicker(value: unknown): unknown {
  if (value === null || typeof value !== "object" || !("source" in value)) return value;
  const previous = value as { source: unknown; customText?: unknown };
  let prefix = "";
  let template: string;
  if (previous.source === "custom" && typeof previous.customText === "string") {
    template = previous.customText.replace(/[{}]/gu, "\\$&");
  } else if (previous.source === "next") {
    prefix = "Next";
    template = "{{next.title}}";
  } else if (previous.source === "other-rooms") {
    template = "{{other_rooms.next}}";
  } else if (previous.source === "questions") {
    template = "Have a question? Submit it in the event app.";
  } else return null;
  return {
    style: "gradient",
    speed: LIVE_TICKER_SPEED.default,
    messages: [{ id: "retained", prefix, template, condition: "always" }],
    segments: [],
  };
}
