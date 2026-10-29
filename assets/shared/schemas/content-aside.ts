import { z } from "zod";

export const CONTENT_ASIDE_NAME = "aside";

/** An authored aside owns ordinary Markdown, including its editable heading. */
export const contentAsideSchema = z
  .object({
    type: z.literal(CONTENT_ASIDE_NAME),
    markdown: z.string(),
  })
  .strict();
export type ContentAside = z.infer<typeof contentAsideSchema>;
