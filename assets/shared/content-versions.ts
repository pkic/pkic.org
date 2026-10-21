import { z } from "zod";

export const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export const contentVersionsSchema = z.object({
  label: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      version: semanticVersionSchema,
      status: z.enum(["released", "draft"]),
      label: z.string(),
      href: z.string(),
      current: z.boolean(),
      latest: z.boolean(),
      fallback: z.boolean(),
    }),
  ),
});
export type ContentVersionNavigation = z.infer<typeof contentVersionsSchema>;
