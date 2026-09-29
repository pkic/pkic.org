import { z } from "zod";
import { httpOrSameOriginUrlSchema } from "./urls";
import { markdownVideoEmbed } from "../markdown-media";

/** Insertion contract for the shared Markdown control; saved content uses its owning form's contract. */
export const markdownMediaInsertSchema = z
  .object({
    kind: z.enum(["image", "video", "link"]),
    url: httpOrSameOriginUrlSchema,
    description: z.string().trim().max(300),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "video" && !markdownVideoEmbed(value.url)) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: value.kind === "video" ? "Use a YouTube or Vimeo video URL." : "Use a web URL or a path on this site.",
      });
    }
    if (value.kind === "image" && !value.description)
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: "Describe the image for readers who cannot see it.",
      });
  });
