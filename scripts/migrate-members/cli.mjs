/**
 * CLI option parsing + environment/bucket config. No YAML/CSV ingestion,
 * no SQL, no execution — see the other scripts/migrate-members/* modules
 * and the migrate-members-yaml-to-d1.mjs entry point for those.
 */
import path from "node:path";

// Matches scripts/seed.mjs's ENVS table — same three wrangler.jsonc
// environments, same binding ("DB") in every one of them.
export const ENVS = {
  local: { wranglerFlag: "--local", wranglerEnv: "local" },
  preview: { wranglerFlag: "--remote", wranglerEnv: "preview" },
  production: { wranglerFlag: "--remote", wranglerEnv: "production" },
};

// Matches wrangler.jsonc's per-environment R2 bucket names (`preview`'s
// `pkic-assets-preview` differs from `local`/`production`'s `pkic-assets`) —
// used as parseArgs's default so `--preview` without an explicit
// `--logo-bucket` doesn't silently upload photos into the production bucket.
export const LOGO_BUCKET_BY_ENV = {
  local: "pkic-assets",
  preview: "pkic-assets-preview",
  production: "pkic-assets",
};

export function parseArgs(argv, root) {
  const parsed = {
    env: null,
    database: "DB",
    persistTo: null,
    dryRun: false,
    uploadLogos: true,
    logoBucket: null,
    logoConcurrency: 4,
    outDir: path.join(root, "ignore"),
    rosterTimeZone: null,
    manualMappingPath: null,
  };

  const environmentFlags = {
    "--local": "local",
    "--preview": "preview",
    "--production": "production",
    "--remote": "production",
  };
  const valueFlags = {
    "--db": "database",
    "--persist-to": "persistTo",
    "--state": "persistTo",
    "--logo-bucket": "logoBucket",
    "--logo-concurrency": "logoConcurrency",
    "--out": "outDir",
    "--roster-time-zone": "rosterTimeZone",
    "--manual-mapping": "manualMappingPath",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue; // pnpm's optional argument separator
    const equals = arg.indexOf("=");
    const flag = equals < 0 ? arg : arg.slice(0, equals);
    const property = valueFlags[flag];
    if (property) {
      const value = equals < 0 ? argv[++i] : arg.slice(equals + 1);
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      const normalized =
        property === "persistTo" || property === "outDir" || property === "manualMappingPath"
          ? path.resolve(root, value)
          : value;
      if (property === "persistTo" && parsed.persistTo && parsed.persistTo !== normalized) {
        throw new Error("Conflicting --state/--persist-to paths");
      }
      parsed[property] = property === "logoConcurrency" ? Number(value) : normalized;
    } else if (environmentFlags[arg]) {
      const environment = environmentFlags[arg];
      if (parsed.env && parsed.env !== environment) throw new Error("Choose only one target environment");
      parsed.env = environment;
    } else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--upload-logos") parsed.uploadLogos = true;
    else if (arg === "--skip-logos") parsed.uploadLogos = false;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!parsed.env && !parsed.dryRun) {
    console.error("Specify one of --local, --preview, --production (or use --dry-run alone to just inspect output).");
    process.exit(1);
  }
  parsed.env = parsed.env ?? "local";
  if (parsed.persistTo && parsed.env !== "local") throw new Error("--state/--persist-to can only be used with --local");
  parsed.logoBucket = parsed.logoBucket ?? LOGO_BUCKET_BY_ENV[parsed.env];
  if (!Number.isInteger(parsed.logoConcurrency) || parsed.logoConcurrency < 1 || parsed.logoConcurrency > 16) {
    console.error("--logo-concurrency must be an integer from 1 through 16.");
    process.exit(1);
  }

  return parsed;
}
