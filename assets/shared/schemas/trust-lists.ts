import { z } from "zod";

/**
 * The two payloads the List of Trust Lists page reads from GitHub.
 *
 * Both come from outside this application — the releases API and the `ltl.json`
 * asset attached to the latest release — so the browser validates them instead
 * of asserting a shape onto whatever arrives.
 */
export const trustListReleaseSchema = z.object({
  assets: z
    .array(z.object({ browser_download_url: z.string().optional(), name: z.string().optional() }).loose())
    .optional(),
  tag_name: z.string().optional(),
});
export type TrustListRelease = z.infer<typeof trustListReleaseSchema>;

const trustEntrySchema = z.object({
  audit: z.array(z.object({ name: z.string().optional() }).loose()).optional(),
  list: z.array(z.object({ type: z.string().optional(), url: z.string().optional() }).loose()).optional(),
  purposes: z.array(z.string()).optional(),
});

export const trustListPublisherSchema = z
  .object({
    description: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    website: z.string().optional(),
    "trust-lists": z
      .object({
        info: z.string().optional(),
        policy: z.string().optional(),
        trust: z.array(trustEntrySchema).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export type TrustListPublisher = z.infer<typeof trustListPublisherSchema>;

export const trustListPublishersSchema = z.array(trustListPublisherSchema);
