import path from "node:path";
import { rehearsalApplicationOrigin, rehearsalInboxOrigin } from "./network.mjs";
import { localBadgePrintKeyring, localBadgePrintEnvValue } from "../local-badge-print-keyring.mjs";
import { randomBytes } from "node:crypto";
import ts from "typescript";
import fs from "node:fs";
import { parseEnv } from "node:util";

const REHEARSAL_CONTROLLED_VAR_NAMES = new Set([
  "APP_BASE_URL",
  "WEBAUTHN_ORIGIN",
  "WEBAUTHN_RP_ID",
  "WEBAUTHN_RP_NAME",
  "INTERNAL_SIGNING_SECRET",
  "MEETING_PROVIDER_ENCRYPTION_KEY",
  "BADGE_PRINT_ENCRYPTION_KEYS",
  "SENDGRID_API_BASE",
  "SENDGRID_API_KEY",
  "TURNSTILE_ENABLED",
  "SERVICE_MODE",
]);

function localWranglerEnvironment(root) {
  const parsed = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8"),
  );
  if (parsed.error) throw new Error("Cannot parse wrangler.jsonc");
  return parsed.config;
}

/** The local D1 binding alone: import and migration commands never load the Worker. */
export function rehearsalDatabaseConfig(root) {
  const base = localWranglerEnvironment(root);
  return {
    name: "pkic-local-rehearsal",
    compatibility_date: base.compatibility_date,
    d1_databases: base.env.local.d1_databases.map(({ binding, database_name, database_id }) => ({
      binding,
      database_name,
      database_id,
      migrations_dir: path.join(root, "migrations"),
      remote: false,
    })),
  };
}

/** Read the Worker that `vite build` emitted for the local publication target. */
export function readBundledWorker(directory) {
  const config = JSON.parse(fs.readFileSync(path.join(directory, "wrangler.json"), "utf8"));
  if (config.targetEnvironment !== "local") throw new Error("The bundled Worker was not built for the local target");
  const main = path.resolve(directory, config.main);
  if (path.dirname(main) !== path.resolve(directory)) throw new Error("The bundled Worker entry must be in its bundle");
  return config;
}

/** Snapshot the bundle so later builds cannot change a running rehearsal; never copy env files. */
export function copyBundledWorker(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (file) => !/^(\.dev\.vars|\.env)/.test(path.basename(file)) && path.basename(file) !== "wrangler.json",
  });
}

/** Values the rehearsal controls in every mode: local identity, isolated keys and captured email. */
function rehearsalVarOverrides({
  state,
  port,
  inboxPort,
  host = "127.0.0.1",
  signingSecret,
  baseUrl = rehearsalApplicationOrigin({ host, port }),
}) {
  return {
    APP_BASE_URL: baseUrl,
    WEBAUTHN_ORIGIN: baseUrl,
    WEBAUTHN_RP_ID: new URL(baseUrl).hostname,
    WEBAUTHN_RP_NAME: "PKIC local rehearsal",
    INTERNAL_SIGNING_SECRET: signingSecret,
    BADGE_PRINT_ENCRYPTION_KEYS: localBadgePrintKeyring(state),
    MEETING_PROVIDER_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    SENDGRID_API_BASE: rehearsalInboxOrigin({ host, inboxPort }),
    SENDGRID_API_KEY: "local-capture-only-not-a-real-key",
    TURNSTILE_ENABLED: "false",
    SERVICE_MODE: "normal",
  };
}

/**
 * Serve the bundled Worker with the rehearsal's own database binding, local-only
 * storage, and captured email. Routes, triggers, services, and the account are not carried over.
 */
export function rehearsalWorkerConfig({ directory, bundle, database }, serving) {
  const local = (bindings = []) => bindings.map((binding) => ({ ...binding, remote: false }));
  return {
    name: database.name,
    main: path.join(directory, path.basename(bundle.main)),
    compatibility_date: bundle.compatibility_date,
    compatibility_flags: bundle.compatibility_flags,
    rules: bundle.rules,
    no_bundle: true,
    ...(bundle.exports ? { exports: bundle.exports } : {}),
    assets: { ...bundle.assets, directory: path.join(serving.state, "site") },
    d1_databases: database.d1_databases,
    r2_buckets: local(bundle.r2_buckets).map(({ binding, bucket_name, remote }) => ({ binding, bucket_name, remote })),
    kv_namespaces: local(bundle.kv_namespaces).map(({ binding, id, remote }) => ({ binding, id, remote })),
    ...(bundle.images ? { images: { binding: bundle.images.binding, remote: false } } : {}),
    worker_loaders: bundle.worker_loaders ?? [],
    // The Worker's own classes (live session rooms) keep their storage in the state directory.
    ...(bundle.durable_objects ? { durable_objects: bundle.durable_objects } : {}),
    ratelimits: bundle.ratelimits,
    vars: { ...bundle.vars, ...rehearsalVarOverrides(serving) },
  };
}

/**
 * The Wrangler configuration the Vite dev server loads for hot reload: the source Worker
 * with only the local environment, every binding local, and the rehearsal's database.
 * Wrangler reads `.dev.vars` beside this file, so the state directory's own vars apply.
 */
export function rehearsalDevConfig(root, database) {
  const base = localWranglerEnvironment(root);
  const local = (bindings = []) => bindings.map((binding) => ({ ...binding, remote: false }));
  const { kv_namespaces, r2_buckets, images, assets, ...environment } = base.env.local;
  return {
    name: base.name,
    main: path.resolve(root, base.main),
    compatibility_date: base.compatibility_date,
    compatibility_flags: base.compatibility_flags,
    ...(base.exports ? { exports: base.exports } : {}),
    env: {
      local: {
        ...environment,
        assets: { ...assets, directory: path.resolve(root, assets.directory) },
        d1_databases: database.d1_databases,
        kv_namespaces: local(kv_namespaces),
        r2_buckets: local(r2_buckets),
        ...(images ? { images: { ...images, remote: false } } : {}),
      },
    },
  };
}

/** The dev server's `.dev.vars`: repository development secrets, then the rehearsal's overrides. */
export function serializeRehearsalDevVars(root, serving) {
  const repositoryVars = path.join(root, ".dev.vars");
  const inherited = fs.existsSync(repositoryVars) ? parseEnv(fs.readFileSync(repositoryVars, "utf8")) : {};
  const vars = { ...inherited, ...rehearsalVarOverrides(serving) };
  return serializeVars(vars, Object.keys(vars));
}

export function rehearsalEnvFiles(root, state) {
  const repositoryVars = path.join(root, ".dev.vars");
  const rehearsalOverrides = path.join(state, ".rehearsal.vars");
  return fs.existsSync(repositoryVars) ? [repositoryVars, rehearsalOverrides] : [rehearsalOverrides];
}

export function serializeRehearsalVars(vars) {
  return serializeVars(
    vars,
    Object.keys(vars).filter((key) => REHEARSAL_CONTROLLED_VAR_NAMES.has(key)),
  );
}

function serializeVars(vars, keys) {
  return [
    "# Rehearsal-controlled values override .dev.vars to keep email and local identity isolated.",
    ...keys.map(
      (key) =>
        `${key}=${key === "BADGE_PRINT_ENCRYPTION_KEYS" ? localBadgePrintEnvValue(vars[key]) : JSON.stringify(vars[key])}`,
    ),
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
