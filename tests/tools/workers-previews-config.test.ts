import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { experimental_readRawConfig as readRawConfig, unstable_readConfig as readConfig } from "wrangler";
import { describe, expect, it } from "vitest";
import { PREVIEW_DATABASE_NAME, wranglerTargetArgs } from "../../scripts/lib/wrangler-target.mjs";
import { previewOriginVars, workersPreviewBaseUrl } from "../../scripts/lib/workers-preview-url.mjs";

const root = resolve(import.meta.dirname, "../..");
const production = readConfig({ config: resolve(root, "wrangler.jsonc"), env: "production" });
const configuredPreviews = production.previews;
if (!configuredPreviews) throw new Error("env.production must declare a previews block");
const previews = configuredPreviews;

type Identified = Record<string, unknown>;
type BindingSet = Pick<
  typeof previews,
  "d1_databases" | "r2_buckets" | "kv_namespaces" | "ratelimits" | "worker_loaders" | "images"
>;

function identifiers(resources: Identified[] | undefined, keys: string[]): string[] {
  return (resources ?? []).flatMap((resource) =>
    keys.map((key) => resource[key]).filter((value): value is string => typeof value === "string" && value !== ""),
  );
}

function bindingNames(config: BindingSet): string[] {
  return [
    ...identifiers(config.d1_databases, ["binding"]),
    ...identifiers(config.r2_buckets, ["binding"]),
    ...identifiers(config.kv_namespaces, ["binding"]),
    ...identifiers(config.ratelimits, ["name"]),
    ...identifiers(config.worker_loaders, ["binding"]),
    ...identifiers(config.images ? [config.images] : [], ["binding"]),
  ];
}

describe("Workers Previews configuration", () => {
  it("binds no production database, bucket, namespace, or rate-limit counter", () => {
    const productionIds = new Set([
      ...identifiers(production.d1_databases, ["database_id", "database_name"]),
      ...identifiers(production.r2_buckets, ["bucket_name"]),
      ...identifiers(production.kv_namespaces, ["id"]),
      ...identifiers(production.ratelimits, ["namespace_id"]),
    ]);
    const previewIds = [
      ...identifiers(previews.d1_databases, ["database_id", "database_name"]),
      ...identifiers(previews.r2_buckets, ["bucket_name"]),
      ...identifiers(previews.kv_namespaces, ["id"]),
      ...identifiers(previews.ratelimits, ["namespace_id"]),
    ];

    expect(previewIds.length).toBeGreaterThan(0);
    expect(previewIds.filter((id) => productionIds.has(id))).toEqual([]);
  });

  it("declares every production binding for Previews", () => {
    expect(new Set(bindingNames(previews))).toEqual(new Set(bindingNames(production)));
  });

  it("keeps production identities, fixed hosts, and live payment keys out of Preview variables", () => {
    const vars = previews.vars ?? {};
    // Each Preview's origin is injected from its own branch at build time.
    expect(vars).not.toHaveProperty("APP_BASE_URL");
    expect(vars).not.toHaveProperty("WEBAUTHN_ORIGIN");
    expect(vars).not.toHaveProperty("TURNSTILE_HOSTNAMES");
    expect(vars.TURNSTILE_ENABLED).toBe("false");
    const serialized = JSON.stringify(vars);
    expect(serialized).not.toMatch(/pkic-org-preview|\/\/pkic\.org|"pkic\.org"/);
    expect(vars.WEBAUTHN_RP_ID).not.toBe(production.vars.WEBAUTHN_RP_ID);
    expect(String(vars.STRIPE_PUBLISHABLE_KEY)).toMatch(/^pk_test_/);
    expect(vars.RSVP_EMAIL).not.toBe(production.vars.RSVP_EMAIL);
  });

  it("injects a branch Preview origin and refuses a build without a branch", () => {
    const vars = previewOriginVars("feature/Workers_Previews");
    expect(vars).toEqual({
      APP_BASE_URL: "https://feature-workers-previews-pkic-org.pkic.workers.dev",
      WEBAUTHN_ORIGIN: "https://feature-workers-previews-pkic-org.pkic.workers.dev",
    });
    for (const origin of Object.values(vars)) {
      const { hostname } = new URL(origin);
      expect(hostname).toMatch(/^[a-z0-9-]+-pkic-org\.pkic\.workers\.dev$/);
      expect(hostname).not.toBe(new URL(production.vars.APP_BASE_URL as string).hostname);
    }
    expect(() => previewOriginVars("main")).toThrow(/non-main branch/);
    expect(() => previewOriginVars("")).toThrow(/non-main branch/);
  });

  it("replaces the separate preview Worker environment", () => {
    const { rawConfig } = readRawConfig({ config: resolve(root, "wrangler.jsonc") });
    expect(Object.keys(rawConfig.env ?? {}).sort()).toEqual(["local", "production"]);
  });

  it("migrates the same shared database the Previews bind", () => {
    const [productionDatabase] = production.d1_databases;
    const [previewDatabase] = previews.d1_databases ?? [];

    // `--env production --preview` selects preview_database_id on the DB binding.
    expect(productionDatabase?.binding).toBe("DB");
    expect(productionDatabase?.preview_database_id).toBe(previewDatabase?.database_id);
    expect(previewDatabase?.database_name).toBe(PREVIEW_DATABASE_NAME);
    expect(wranglerTargetArgs("preview")).toEqual(["--env", "production", "--preview"]);
    expect(wranglerTargetArgs("production")).toEqual(["--env", "production"]);
    // d1 export has no --preview option, so the backup names the preview database.
    const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["backup:preview"]).toContain(`d1 export ${PREVIEW_DATABASE_NAME} --env production --remote`);
    expect(scripts["migrate:preview"]).toBe("node scripts/apply-d1-migrations.mjs preview");
  });

  it("derives a branch Preview URL only for non-production branches", () => {
    expect(workersPreviewBaseUrl("codex/Workers_Previews")).toBe(
      "https://codex-workers-previews-pkic-org.pkic.workers.dev",
    );
    expect(workersPreviewBaseUrl("main")).toBeNull();
    expect(workersPreviewBaseUrl(undefined)).toBeNull();
    expect(workersPreviewBaseUrl("///")).toBeNull();
  });
});
