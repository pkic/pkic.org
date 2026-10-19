import path from "node:path";

/** Repository build outputs that the local publication writes and the rehearsal snapshots. */
export function rehearsalBuildOutputs(root) {
  return {
    worker: path.join(root, "dist/pkic_org_base"),
    site: path.join(root, "dist/client"),
    stale: [path.join(root, "dist"), path.join(root, ".wrangler/deploy/config.json")],
  };
}

/**
 * Build the local publication from the rehearsal's own D1 state: the bundled Worker
 * and public shell first, then the Astro publication assembled into its assets.
 * The build reads the imported database but never migrates or seeds it.
 *
 * `watch` builds only the publication for the hot-reloading dev server, which compiles the
 * Worker itself; it skips the slow assets and links the client bundle by its development names.
 *
 * `fast` skips the slow assets the portal and event pages do not need. `withoutR2Media`
 * is for a restored backup: the dump holds no R2 uploads, so approved images whose
 * objects are absent locally publish as missing instead of failing the build.
 */
export function rehearsalBuildSteps(env, state, { fast = false, watch = false, withoutR2Media = false } = {}) {
  const buildEnv = {
    ...env,
    CLOUDFLARE_ENV: "local",
    PKIC_PUBLICATION_LOCAL_STATE: path.join(state, "v3"),
    ...(fast || watch ? { PKIC_PUBLICATION_FAST: "1" } : {}),
    ...(watch ? { PKIC_CLIENT_DEV: "1" } : {}),
    ...(withoutR2Media ? { PKIC_PUBLICATION_MISSING_R2_MEDIA: "omit" } : {}),
  };
  const prepare = {
    command: process.execPath,
    args: ["--experimental-strip-types", "scripts/prepare-public.mjs", "--dev"],
    env: buildEnv,
  };
  const publish = (...target) => ({
    command: process.execPath,
    args: ["--experimental-strip-types", "scripts/publication/build-local-publication.mjs", ...target],
    env: buildEnv,
  });
  // The publication prepares the static assets itself.
  if (watch) return [publish()];
  return [prepare, { command: "pnpm", args: ["exec", "vite", "build"], env: buildEnv }, publish("dist/client")];
}

/**
 * The hot-reloading processes: the Vite dev server compiles and reloads the Worker from
 * source against the rehearsal's state, and a watching client build rewrites the portal
 * bundle under its stable development names, so a page reload shows the change.
 */
export function rehearsalWatchProcesses(env, { root, configPath, state, port, host = "127.0.0.1" }) {
  const devEnv = {
    ...env,
    CLOUDFLARE_ENV: "local",
    PKIC_CLIENT_DEV: "1",
    PKIC_DEV_WRANGLER_CONFIG: configPath,
    PKIC_DEV_STATE: state,
  };
  return [
    {
      command: process.execPath,
      args: ["scripts/build-frontend.mjs", "--watch"],
      env: devEnv,
    },
    {
      // Run the installed CLI directly: a pnpm wrapper does not forward the stop signal.
      command: process.execPath,
      args: [
        path.join(root, "node_modules/vite/bin/vite.js"),
        "dev",
        "--host",
        host,
        "--port",
        String(port),
        "--strictPort",
      ],
      env: devEnv,
    },
  ];
}
