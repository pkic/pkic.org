import { z } from "zod";
import { httpOrSameOriginUrlSchema } from "./urls";

/** The agenda's rendered affiliation: frozen credited text and its canonical public organization mark. */
export const agendaSpeakerAffiliationContentSchema = z
  .object({
    title: z.string().max(200).optional(),
    organization: z
      .object({
        name: z.string().min(1).max(200),
        logoSrc: httpOrSameOriginUrlSchema.optional(),
        href: httpOrSameOriginUrlSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AgendaSpeakerAffiliationContent = z.infer<typeof agendaSpeakerAffiliationContentSchema>;
