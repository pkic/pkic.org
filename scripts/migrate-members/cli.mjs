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
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--local") parsed.env = "local";
    else if (arg === "--preview") parsed.env = "preview";
    else if (arg === "--production" || arg === "--remote") parsed.env = "production";
    else if (arg === "--db" && next) {
      parsed.database = next;
      i += 1;
    } else if (arg === "--persist-to" && next) {
      parsed.persistTo = next;
      i += 1;
    } else if (arg === "--dry-run") parsed.dryRun = true;
    // --upload-logos is now the default; kept as an accepted no-op flag so
    // existing invocations (docs, muscle memory) don't break.
    else if (arg === "--upload-logos") parsed.uploadLogos = true;
    else if (arg === "--skip-logos") parsed.uploadLogos = false;
    else if (arg === "--logo-bucket" && next) {
      parsed.logoBucket = next;
      i += 1;
    } else if (arg === "--logo-concurrency" && next) {
      parsed.logoConcurrency = Number(next);
      i += 1;
    } else if (arg === "--out" && next) {
      parsed.outDir = path.isAbsolute(next) ? next : path.join(root, next);
      i += 1;
    }
  }

  if (!parsed.env && !parsed.dryRun) {
    console.error("Specify one of --local, --preview, --production (or use --dry-run alone to just inspect output).");
    process.exit(1);
  }
  parsed.env = parsed.env ?? "local";
  parsed.logoBucket = parsed.logoBucket ?? LOGO_BUCKET_BY_ENV[parsed.env];
  if (!Number.isInteger(parsed.logoConcurrency) || parsed.logoConcurrency < 1 || parsed.logoConcurrency > 16) {
    console.error("--logo-concurrency must be an integer from 1 through 16.");
    process.exit(1);
  }

  return parsed;
}
