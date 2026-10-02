import { z } from "zod";

export const clientStylesheetSchema = z.object({ url: z.string().min(1), integrity: z.string().optional() });
const clientEntrySchema = z.object({
  url: z.string().min(1),
  integrity: z.string().optional(),
  stylesheets: z.array(clientStylesheetSchema).default([]),
});
export const clientAssetManifestSchema = z.object({
  loader: clientEntrySchema,
  publicSite: clientEntrySchema.optional(),
});
export type ClientStylesheet = z.infer<typeof clientStylesheetSchema>;
