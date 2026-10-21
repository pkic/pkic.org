import { z } from "zod";

const version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const modelVersionRootSchema = z
  .string()
  .regex(/^\/wg\/[a-z0-9./-]+\/$/)
  .refine((path) => !path.includes("//") && !path.split("/").some((part) => part === "." || part === ".."));
const draftRoot = modelVersionRootSchema.refine((path) =>
  /^\/wg\/pqc\/pqcmm\/drafts\/[a-z0-9][a-z0-9.-]*\/$/.test(path),
);
const entry = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  version,
  root: modelVersionRootSchema,
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourcePath: z.string().optional(),
  aliases: z.array(modelVersionRootSchema).default([]),
});
export const modelDraftSchema = entry.extend({
  status: z.literal("draft"),
  root: draftRoot,
  branch: z.string().min(1),
  aliases: z.array(draftRoot).default([]),
});
export const modelVersionSchema = z.discriminatedUnion("status", [
  entry.extend({ status: z.literal("released"), tag: z.string(), branch: z.string().optional() }),
  modelDraftSchema,
]);
export type ModelDraft = z.infer<typeof modelDraftSchema>;
export type ModelVersion = z.infer<typeof modelVersionSchema>;

/** Expected versions may change; stable draft ids preserve the review work's identity. */
export function modelVersionLinks(
  versions: readonly Pick<ModelVersion, "id" | "version" | "status" | "root">[],
  route: string,
  availableRoutes: ReadonlySet<string> = new Set(),
) {
  const current = [...versions].sort((a, b) => b.root.length - a.root.length).find((v) => route.startsWith(v.root));
  return {
    activeId: current?.id ?? "",
    items: versions.map((v) => {
      const candidate = current ? `${v.root}${route.slice(current.root.length)}` : v.root;
      const equivalent = availableRoutes.has(candidate);
      return {
        id: v.id,
        version: v.version,
        status: v.status,
        label: v.status === "draft" ? `${v.version} — Draft` : v.version,
        href: current && equivalent ? candidate : v.root,
        fallback: Boolean(current && route !== current.root && !equivalent),
      };
    }),
  };
}

export type ModelVersionSource = Pick<ModelVersion, "id" | "version" | "commit" | "sha256">;

export type ModelVersionNavigationData = ReturnType<typeof modelVersionLinks> & {
  root: string;
  label: string;
  latestId?: string;
};
