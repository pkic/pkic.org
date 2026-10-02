import { z } from "zod";
import { httpOrSameOriginUrlSchema, sameOriginPathSchema } from "./urls.ts";

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

export const sitePublicationSnapshotIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** The complete set of pages and public assets owned by one publication. */
export const sitePublicationReleaseSchema = z.object({
  version: z.literal(1),
  source: z.enum(["fixture", "native"]),
  snapshotId: sitePublicationSnapshotIdSchema,
  environment: z.enum(["local", "preview", "production"]),
  redirects: z
    .array(
      z.object({
        from: staticRedirectPathSchema,
        to: httpOrSameOriginUrlSchema.refine(safeRedirectToken, "Redirect targets must be encoded URLs"),
        status: z.union([z.literal(301), z.literal(302), z.literal(308)]).default(301),
      }),
    )
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
