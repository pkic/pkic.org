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
      revision: z.object({ label: z.string().min(1), href: z.httpUrl() }).optional(),
    }),
  ),
});
export type ContentVersionNavigation = z.infer<typeof contentVersionsSchema>;

/** A current release needs no warning; drafts and older editions keep an escape to its equivalent page. */
export function contentVersionNotice(versions?: ContentVersionNavigation) {
  const current = versions?.items.find((item) => item.current);
  const latest = versions?.items.find((item) => item.latest);
  if (!current || !latest || current.latest) return undefined;
  return {
    version: current.version,
    status: current.status,
    currentHref: latest.href,
    ...(current.revision ? { revision: current.revision } : {}),
  };
}
export type ContentVersionNoticeData = NonNullable<ReturnType<typeof contentVersionNotice>>;
