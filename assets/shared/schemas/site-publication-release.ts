import { z } from "zod";
import { httpOrSameOriginUrlSchema, sameOriginPathSchema } from "./urls.ts";
import { parseSessionPresentationPublicUrl } from "../session-presentation-public-url.ts";
import { presentationByteCountSchema } from "./event-agenda-legacy-fragments.ts";
import { publicationDocumentSelectionSchema } from "./site-publication-documents.ts";

function safeRedirectToken(path: string): boolean {
  return (
    !/\s/.test(path) &&
    Array.from(path).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
  );
}

const staticRedirectPathSchema = sameOriginPathSchema.refine(
  safeRedirectToken,
  "Static redirect paths must not contain whitespace or control characters",
);

export const sitePublicationRedirectSchema = z.object({
  from: staticRedirectPathSchema,
  to: httpOrSameOriginUrlSchema.refine(safeRedirectToken, "Redirect targets must be encoded URLs"),
  status: z.union([z.literal(301), z.literal(302), z.literal(308)]).default(301),
});

export const sitePublicationSnapshotIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const sitePublicationSourceSequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const sitePublicationIntegrityPathSchema = z
  .string()
  .max(1024)
  .refine(
    (path) =>
      path.length > 0 &&
      !/[\\?#]/.test(path) &&
      Array.from(path).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
      !path.startsWith("/") &&
      path !== "publication.json" &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "Unsafe publication integrity path",
  );
export const sitePublicationIntegritySchema = z
  .object({
    algorithm: z.literal("sha256"),
    digest: sitePublicationSnapshotIdSchema,
    files: z.record(
      sitePublicationIntegrityPathSchema,
      z.object({
        sha256: sitePublicationSnapshotIdSchema,
        bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }),
    ),
  })
  .refine(
    (value) => Object.keys(value.files).length > 0 && Object.keys(value.files).length <= 100_000,
    "Invalid integrity inventory size",
  );

export const PUBLICATION_DOCUMENT_ROUTES_PATH = "_published/agenda/document-routes.json";

/** Integrity-owned public routes and exact byte copies retired by this release. */
export const sitePublicationDocumentRoutesSchema = z
  .object({
    version: z.literal(1),
    snapshotId: sitePublicationSnapshotIdSchema,
    sourceSequence: sitePublicationSourceSequenceSchema.nullable(),
    documents: z
      .array(publicationDocumentSelectionSchema)
      .max(10000)
      .default([])
      .refine(
        (documents) => new Set(documents.map(({ url }) => url)).size === documents.length,
        "Duplicate canonical document selection",
      ),
    redirects: z
      .array(
        sitePublicationRedirectSchema
          .extend({ status: z.literal(302) })
          .refine(
            ({ to }) => parseSessionPresentationPublicUrl(to) !== null,
            "Document redirects must target a canonical session presentation",
          ),
      )
      .max(2000)
      .refine(
        (entries) => new Set(entries.map(({ from }) => from)).size === entries.length,
        "Duplicate document redirect",
      ),
    retiredPaths: z
      .array(
        z
          .object({
            path: sitePublicationIntegrityPathSchema,
            sha256: sitePublicationSnapshotIdSchema,
            bytes: presentationByteCountSchema,
          })
          .strict(),
      )
      .max(2000)
      .refine(
        (entries) => new Set(entries.map(({ path }) => path)).size === entries.length,
        "Duplicate retired document path",
      ),
  })
  .strict();
export type SitePublicationDocumentRoutes = z.infer<typeof sitePublicationDocumentRoutesSchema>;

/** Canonical hash input shared by release generation and verification. */
export function publicationIntegrityHashInput(files: z.infer<typeof sitePublicationIntegritySchema>["files"]): string {
  return JSON.stringify(Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
}

/** The complete set of pages and public assets owned by one publication. */
export const sitePublicationReleaseSchema = z.object({
  version: z.literal(1),
  source: z.enum(["fixture", "native"]),
  snapshotId: sitePublicationSnapshotIdSchema,
  sourceSequence: sitePublicationSourceSequenceSchema.nullable().default(null),
  integrity: sitePublicationIntegritySchema.optional(),
  environment: z.enum(["local", "preview", "production"]),
  redirects: z
    .array(sitePublicationRedirectSchema)
    .refine((entries) => new Set(entries.map(({ from }) => from)).size === entries.length, "Duplicate redirect source")
    .default([]),
  privatePaths: z.array(staticRedirectPathSchema).default([]),
  files: z
    .array(
      z.union([
        z.literal("404.html"),
        z.literal("robots.txt"),
        z
          .string()
          .max(1024)
          .refine(
            (path) =>
              !/[\\?#]/.test(path) &&
              Array.from(path).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
              !path.startsWith("/") &&
              path.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
              (path === "index.html" ||
                path.endsWith("/index.html") ||
                /\.(?:xml|svg|pdf|ics|csv|zip|pptx?|docx?|xlsx?|txt|json|ya?ml|avif|webp|png|jpe?g|gif|ico|js|css|woff2?|ttf|otf)$/i.test(
                  path,
                )),
            "Unsafe publication file path",
          ),
      ]),
    )
    .min(1),
});
export type SitePublicationRelease = z.infer<typeof sitePublicationReleaseSchema>;
