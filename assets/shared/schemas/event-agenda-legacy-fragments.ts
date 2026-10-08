import { z } from "zod";
import { databaseIdSchema } from "./identifiers.ts";
import { sameOriginPathSchema } from "./urls.ts";
import { MAX_PRESENTATION_BYTES } from "../presentation-upload.ts";

/** Observed Hugo IDs can contain slashes and Unicode; primary public anchors remain stricter. */
export const legacyAgendaFragmentAnchorSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[^\s\p{Cc}#<>"'`]+$/u);
export const legacyAgendaFragmentSchema = z.object({
  anchor: legacyAgendaFragmentAnchorSchema,
  kind: z.enum(["dialog", "dialog_label"]),
  roomRef: z.string().min(1).max(300),
  roomId: databaseIdSchema.nullable(),
  sourcePath: z.string().min(1).max(1000),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceLocator: z.string().min(1).max(500),
  authoredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  authoredStart: z.string().min(1).max(20),
  authoredTitle: z.string().max(10000).nullable(),
});
export const legacyAgendaFragmentsSchema = z
  .array(legacyAgendaFragmentSchema)
  .max(40)
  .refine(
    (fragments) => new Set(fragments.map((fragment) => fragment.anchor)).size === fragments.length,
    "Retain each observed fragment once.",
  )
  .default([]);
export type LegacyAgendaFragment = z.infer<typeof legacyAgendaFragmentSchema>;
export const legacyAgendaDownloadUrlSchema = sameOriginPathSchema.refine(
  (url) => /^\/events\/[^/]+\/.+\.pdf$/iu.test(url) && !/[?#]/u.test(url),
);
export const presentationByteCountSchema = z.number().int().positive().max(MAX_PRESENTATION_BYTES);
export const legacyAgendaDownloadSchema = z
  .object({
    url: legacyAgendaDownloadUrlSchema,
    targetUrl: sameOriginPathSchema.refine(
      (url) => /^\/content-media\/events\/[^/]+\/.+\.pdf$/iu.test(url) && !/[?#]/u.test(url),
    ),
    sourcePath: z.string().min(1).max(1000),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceLocator: z.string().min(1).max(500),
    pdfDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
      .default(null),
    pdfBytes: presentationByteCountSchema.nullable().default(null),
  })
  .refine(
    (download) => download.url === download.targetUrl.replace(/^\/content-media/u, ""),
    "Retain the exact authored public bundle URL.",
  )
  .refine((download) => (download.pdfDigest === null) === (download.pdfBytes === null), {
    path: ["pdfDigest"],
    message: "Retain the PDF digest and byte count together.",
  });
export type LegacyAgendaDownload = z.infer<typeof legacyAgendaDownloadSchema>;
export const legacyAgendaDownloadsSchema = z
  .array(legacyAgendaDownloadSchema)
  .max(10)
  .refine(
    (downloads) => new Set(downloads.map((download) => download.url)).size === downloads.length,
    "Retain each observed download once.",
  )
  .default([]);
