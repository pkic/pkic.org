import { resolve } from "node:path";
import { experimental_readRawConfig as readRawConfig, unstable_readConfig as readConfig } from "wrangler";
import { describe, expect, it } from "vitest";
import { PREVIEW_RESOURCES_CONFIG, wranglerTargetArgs } from "../../scripts/lib/wrangler-target.mjs";
import { workersPreviewBaseUrl } from "../../scripts/lib/workers-preview-url.mjs";

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

  it("keeps production identities and live payment keys out of Preview variables", () => {
    const vars = previews.vars ?? {};
    expect(new URL(String(vars.APP_BASE_URL)).hostname).toMatch(/\.workers\.dev$/);
    expect(vars.WEBAUTHN_RP_ID).not.toBe(production.vars.WEBAUTHN_RP_ID);
    expect(String(vars.STRIPE_PUBLISHABLE_KEY)).toMatch(/^pk_test_/);
    expect(vars.RSVP_EMAIL).not.toBe(production.vars.RSVP_EMAIL);
  });

  it("replaces the separate preview Worker environment", () => {
    const { rawConfig } = readRawConfig({ config: resolve(root, "wrangler.jsonc") });
    expect(Object.keys(rawConfig.env ?? {}).sort()).toEqual(["local", "production"]);
  });

  it("migrates the same shared database the Previews bind", () => {
    const migrations = readConfig({ config: resolve(root, PREVIEW_RESOURCES_CONFIG) });
    const [database] = migrations.d1_databases;
    const [previewDatabase] = previews.d1_databases ?? [];

    expect(migrations.d1_databases).toHaveLength(1);
    expect(database).toMatchObject({
      binding: "PREVIEW_DB",
      database_name: previewDatabase?.database_name,
      database_id: previewDatabase?.database_id,
      migrations_dir: "migrations",
    });
    expect(migrations.account_id).toBe(production.account_id);
    expect(wranglerTargetArgs("preview")).toEqual(["--config", PREVIEW_RESOURCES_CONFIG]);
    expect(wranglerTargetArgs("production")).toEqual(["--env", "production"]);
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
