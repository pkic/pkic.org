import { z } from "zod";

export const contentContainerNames = ["aside", "columns", "grid", "item", "cards", "card"] as const;
export const contentLayoutSchema = z.enum(["auto", "1", "2", "3", "4"]);
export const contentColumnWidthSchema = z.enum(["auto", "16rem", "18rem", "20rem", "24rem", "32rem"]);
export const contentCardVariantSchema = z.enum(["default", "muted", "accent", "plain"]);
export const contentGridLayoutSchema = z.enum(["grid", "bento"]);
export const contentSpanSchema = z.enum(["1", "2"]);
export const contentMediaSchema = z.enum(["image", "logo"]);
/** Names of the authored SVG assets in assets/icons; no author-supplied SVG or icon URLs. */
export const contentIconSchema = z.enum([
  "alert-triangle",
  "award",
  "bar-chart",
  "bolt",
  "building",
  "calendar",
  "check-circle",
  "clock",
  "cloud",
  "compass",
  "cpu",
  "flag",
  "gavel",
  "globe",
  "key",
  "landmark",
  "layers",
  "lightbulb",
  "link",
  "lock",
  "network",
  "package",
  "refresh",
  "search",
  "settings",
  "shield-check",
  "target",
  "telescope",
  "terminal",
  "trending-up",
  "users",
]);
export const contentContainerSchema = z
  .object({
    type: z.enum(contentContainerNames),
    markdown: z.string(),
    count: contentLayoutSchema.optional(),
    width: contentColumnWidthSchema.optional(),
    variant: contentCardVariantSchema.optional(),
    layout: contentGridLayoutSchema.optional(),
    span: contentSpanSchema.optional(),
    rows: contentSpanSchema.optional(),
    icon: contentIconSchema.optional(),
    media: contentMediaSchema.optional(),
  })
  .strict()
  .superRefine((block, context) => {
    const allowed: Record<string, readonly string[]> = {
      count: ["columns", "grid", "cards"],
      width: ["columns"],
      variant: ["cards", "card"],
      layout: ["cards"],
      span: ["card", "item"],
      rows: ["card", "item"],
      icon: ["card"],
      media: ["card"],
    };
    for (const [attribute, types] of Object.entries(allowed))
      if (block[attribute as keyof typeof block] !== undefined && !types.includes(block.type))
        context.addIssue({
          code: "custom",
          path: [attribute],
          message: `${attribute} is not supported on ${block.type}.`,
        });
  });
export type ContentContainer = z.infer<typeof contentContainerSchema>;
export type ContentContainerName = ContentContainer["type"];
export const contentAttributeNames = Object.keys(contentContainerSchema.shape).filter(
  (key) => key !== "type" && key !== "markdown",
) as Array<Exclude<keyof ContentContainer, "type" | "markdown">>;
