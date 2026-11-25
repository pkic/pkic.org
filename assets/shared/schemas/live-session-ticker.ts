import { publicPageSlugSchema } from "./public-page-slug";
import { z } from "zod";
import { validateOverlayTextTemplate } from "../overlay-text-template";
/** The most messages one ticker sequence holds. */
export const LIVE_TICKER_MESSAGES_MAX = 20;

export const liveTickerMessageSchema = z
  .object({
    id: z.string().min(1).max(80),
    prefix: z.string().trim().max(40),
    template: z.string().trim().min(1).max(500),
    condition: z.enum(["always", "near-session-end"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const message = validateOverlayTextTemplate(value.template);
    if (message) ctx.addIssue({ code: "custom", path: ["template"], message });
  });
/** How fast the ticker scrolls: an operator's choice, read the same on every output. */
export const LIVE_TICKER_SPEEDS = ["slow", "normal", "fast"] as const;
export type LiveTickerSpeed = (typeof LIVE_TICKER_SPEEDS)[number];
/**
 * How far each speed moves the ticker in a second, in pixels of the 1920 × 1080
 * frame, whatever the length of its messages. Normal is slow enough to read a
 * message through once as it crosses the frame.
 */
export const LIVE_TICKER_PIXELS_PER_SECOND: Record<LiveTickerSpeed, number> = { slow: 60, normal: 90, fast: 130 };

export const liveTickerConfigSchema = z
  .object({
    style: z.enum(["gradient", "accent", "neutral"]),
    // A ticker saved before the speed existed scrolls at the normal speed.
    speed: z.enum(LIVE_TICKER_SPEEDS).default("normal"),
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
  speed: "normal",
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
    speed: "normal",
    messages: [{ id: "retained", prefix, template, condition: "always" }],
    segments: [],
  };
}
