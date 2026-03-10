/**
 * Unified seed orchestrator.
 *
 * Usage:
 *   node scripts/seed.mjs --local                  # local D1 / local R2
 *   node scripts/seed.mjs --preview                # remote preview env
 *   node scripts/seed.mjs --production             # remote production env
 *
 * Optional flags:
 *   --only admin|event|templates   run only one component (can repeat)
 *   --skip-migrations              skip D1 migration apply step
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// ── Environment definitions ────────────────────────────────────────────────

const ENVS = {
  local: {
    wranglerFlag: "--local",
    wranglerEnv: null,
    database: "pkic-db",
    assetsBucket: "pkic-assets",
    speakerBucket: "pkic-speaker-uploads",
    label: "local",
  },
  preview: {
    wranglerFlag: "--remote",
    wranglerEnv: "preview",       // maps to env.preview in wrangler.jsonc
    database: "pkic-db-preview",
    assetsBucket: "pkic-assets-preview",
    speakerBucket: "pkic-speaker-uploads-preview",
    label: "preview (remote)",
  },
  production: {
    wranglerFlag: "--remote",
    wranglerEnv: null,
    database: "pkic-db",
    assetsBucket: "pkic-assets",
    speakerBucket: "pkic-speaker-uploads",
    label: "production (remote)",
  },
};

/** Return ["--env", name] when an env name is set, otherwise []. */
function envFlag(cfg) {
  return cfg.wranglerEnv ? ["--env", cfg.wranglerEnv] : [];
}

// ── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  let env = null;
  const only = new Set();
  let skipMigrations = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--local") { env = "local"; continue; }
    if (arg === "--preview") { env = "preview"; continue; }
    if (arg === "--production" || arg === "--remote") { env = "production"; continue; }

    if (arg === "--only" && argv[i + 1]) {
      only.add(argv[++i]);
      continue;
    }

    if (arg === "--skip-migrations") {
      skipMigrations = true;
      continue;
    }
  }

  if (!env) {
    console.error(
      "Usage: node scripts/seed.mjs --local | --preview | --production [--only admin|event|templates] [--skip-migrations]",
    );
    process.exit(1);
  }

  return { env, only, skipMigrations };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd, args) {
  console.log(`\n► ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: process.cwd(), stdio: "inherit" });
}

function script(file) {
  return resolve(process.cwd(), "scripts", file);
}

// ── Steps ───────────────────────────────────────────────────────────────────

function applyMigrations(cfg) {
  run("npx", ["wrangler", "d1", "migrations", "apply", cfg.database, ...envFlag(cfg), cfg.wranglerFlag]);
}

function seedAdmin(cfg) {
  run("node", [script("seed-initial-admin.mjs"), cfg.wranglerFlag, "--db", cfg.database, ...envFlag(cfg)]);
}

function seedEvent(cfg) {
  run("node", [
    script("seed-event.mjs"),
    cfg.wranglerFlag,
    "--db", cfg.database,
    ...envFlag(cfg),
    "--bucket", cfg.assetsBucket,
    "--skip-email-templates",
  ]);
}

function seedTemplates(cfg) {
  run("node", [
    script("seed-email-templates.mjs"),
    cfg.wranglerFlag,
    "--db", cfg.database,
    ...envFlag(cfg),
    "--bucket", cfg.assetsBucket,
  ]);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const { env, only, skipMigrations } = parseArgs(process.argv.slice(2));
const cfg = ENVS[env];
const runAll = only.size === 0;

console.log(`\nSeeding ${cfg.label} …`);

if (!skipMigrations) applyMigrations(cfg);

if (runAll || only.has("admin")) seedAdmin(cfg);
if (runAll || only.has("event")) seedEvent(cfg);
if (runAll || only.has("templates")) seedTemplates(cfg);

console.log(`\n✓ Done seeding ${cfg.label}.`);
