import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { z } from "zod";

/** Bundle the canonical contracts in memory; their extensionless TS imports are not native Node imports. */
export async function loadImportContracts() {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      target: "node22",
      lib: { entry: fileURLToPath(new URL("./contracts-entry.mjs", import.meta.url)), formats: ["es"] },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
  const chunks = outputs.filter((item) => item.type === "chunk");
  if (chunks.length !== 1 || chunks[0].imports.length)
    throw new Error("Could not load self-contained import contracts");
  return import(`data:text/javascript;base64,${Buffer.from(chunks[0].code).toString("base64")}`);
}

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function manifestSchema(contracts) {
  const reviewed = contracts.membershipApplicationImportRequestSchema
    .omit({ runId: true })
    .extend({
      decision: z.literal("import"),
      reviewedBy: z.string().trim().min(1).max(200),
      reviewedAt: contracts.utcInstantSchema,
    })
    .strict();
  const deferred = z
    .object({
      decision: z.enum(["exclude", "unresolved"]),
      sourceIssueNumber: z.number().int().positive(),
      reason: z.string().trim().min(1).max(2000),
      owner: z.string().trim().min(1).max(200),
    })
    .strict();
  return z
    .object({
      version: z.literal(1),
      runId: contracts.membershipApplicationImportRequestSchema.shape.runId,
      portalOrigin: z
        .url()
        .refine((value) => new URL(value).origin === value, "Use an origin without a path or credentials"),
      environment: z.enum(["production", "local"]),
      sourceData: z.enum(["private", "synthetic"]),
      entries: z
        .array(z.union([reviewed, deferred]))
        .min(1)
        .max(2000),
    })
    .strict()
    .superRefine((manifest, ctx) => {
      const seen = new Set();
      manifest.entries.forEach((entry, index) => {
        if (seen.has(entry.sourceIssueNumber))
          ctx.addIssue({
            code: "custom",
            path: ["entries", index, "sourceIssueNumber"],
            message: "Duplicate source issue",
          });
        seen.add(entry.sourceIssueNumber);
      });
    });
}

export function parseManifest(input, contracts, productionOrigin) {
  const parsed = manifestSchema(contracts).safeParse(input);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "manifest"))];
    throw new Error(`Invalid reviewed manifest; check: ${paths.slice(0, 10).join(", ")}`);
  }
  const manifest = parsed.data;
  const target = new URL(manifest.portalOrigin);
  if (manifest.environment === "production") {
    if (manifest.portalOrigin !== productionOrigin || target.protocol !== "https:")
      throw new Error("Production imports must target the configured production portal origin");
  } else if (
    manifest.sourceData !== "synthetic" ||
    target.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  ) {
    throw new Error("Local rehearsal requires synthetic data and an HTTP loopback origin");
  }
  return manifest;
}

export function requestFor(manifest, entry, contracts) {
  return contracts.membershipApplicationImportRequestSchema.parse({ ...entry, runId: manifest.runId });
}
