import path from "node:path";
import { randomBytes } from "node:crypto";
import ts from "typescript";
import fs from "node:fs";

const REHEARSAL_CONTROLLED_VAR_NAMES = new Set([
  "APP_BASE_URL",
  "WEBAUTHN_ORIGIN",
  "WEBAUTHN_RP_ID",
  "WEBAUTHN_RP_NAME",
  "INTERNAL_SIGNING_SECRET",
  "MEETING_PROVIDER_ENCRYPTION_KEY",
  "SENDGRID_API_BASE",
  "SENDGRID_API_KEY",
  "TURNSTILE_ENABLED",
  "SERVICE_MODE",
]);

export function rehearsalConfig(root, state, port, inboxPort, signingSecret) {
  const parsed = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8"),
  );
  if (parsed.error) throw new Error("Cannot parse wrangler.jsonc");
  const base = parsed.config;
  const local = base.env.local;
  return {
    name: "pkic-local-rehearsal",
    main: path.join(root, base.main),
    compatibility_date: base.compatibility_date,
    compatibility_flags: base.compatibility_flags,
    tsconfig: path.relative(state, path.join(root, "tsconfig.json")),
    assets: { ...local.assets, directory: path.join(state, "site") },
    d1_databases: local.d1_databases.map(({ binding, database_name, database_id }) => ({
      binding,
      database_name,
      database_id,
      migrations_dir: path.join(root, "migrations"),
      remote: false,
    })),
    r2_buckets: local.r2_buckets.map(({ binding, bucket_name }) => ({ binding, bucket_name, remote: false })),
    kv_namespaces: local.kv_namespaces.map(({ binding, id }) => ({ binding, id, remote: false })),
    ratelimits: local.ratelimits,
    vars: {
      ...local.vars,
      APP_BASE_URL: `http://localhost:${port}`,
      WEBAUTHN_ORIGIN: `http://localhost:${port}`,
      WEBAUTHN_RP_ID: "localhost",
      WEBAUTHN_RP_NAME: "PKIC local rehearsal",
      INTERNAL_SIGNING_SECRET: signingSecret,
      MEETING_PROVIDER_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      SENDGRID_API_BASE: `http://127.0.0.1:${inboxPort}`,
      SENDGRID_API_KEY: "local-capture-only-not-a-real-key",
      TURNSTILE_ENABLED: "false",
      SERVICE_MODE: "normal",
    },
  };
}

export function rehearsalEnvFiles(root, state) {
  const repositoryVars = path.join(root, ".dev.vars");
  const rehearsalOverrides = path.join(state, ".rehearsal.vars");
  return fs.existsSync(repositoryVars) ? [repositoryVars, rehearsalOverrides] : [rehearsalOverrides];
}

export function serializeRehearsalVars(vars) {
  return [
    "# Rehearsal-controlled values override .dev.vars to keep email and local identity isolated.",
    ...Object.entries(vars)
      .filter(([key]) => REHEARSAL_CONTROLLED_VAR_NAMES.has(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`),
    "",
  ].join("\n");
}

export function rehearsalEnvironment(env) {
  // Do not inherit provider credentials, NODE_OPTIONS, or Wrangler overrides.
  return Object.fromEntries(
    Object.entries(env).filter(([key]) =>
      /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|SystemRoot|COMSPEC|PATHEXT|LANG|LC_ALL)$/i.test(key),
    ),
  );
}
