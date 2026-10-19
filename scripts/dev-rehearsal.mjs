import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rehearsalOrigin, rehearsalInboxOrigin } from "./rehearsal/network.mjs";
import { parseRehearsalOptions } from "./rehearsal/options.mjs";
import { agendaPlanArguments, agendaPlanFiles } from "./rehearsal/plans.mjs";
import { exportD1Backup } from "./backup-d1.mjs";
import {
  copyBundledWorker,
  readBundledWorker,
  rehearsalDatabaseConfig,
  rehearsalDevConfig,
  rehearsalEnvironment,
  rehearsalEnvFiles,
  rehearsalWorkerConfig,
  serializeRehearsalDevVars,
  serializeRehearsalVars,
} from "./rehearsal/config.mjs";
import { rehearsalBuildOutputs, rehearsalBuildSteps, rehearsalWatchProcesses } from "./rehearsal/build.mjs";
import {
  assertPortAvailable,
  freshFixtureFiles,
  freshSeedArguments,
  freshStartupSummary,
  missingPrerequisite,
  prepareFreshState,
  resetFreshState,
  waitForServer,
  writeFreshManifest,
} from "./rehearsal/fresh.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = rehearsalEnvironment(process.env);
const run = (command, args, cwd = root, runEnv = env) =>
  execFileSync(command, args, { cwd, env: runEnv, stdio: "inherit" });
// Without a terminal on stdin, Wrangler applies migrations without asking for confirmation.
const runUnattended = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, env, stdio: ["ignore", "inherit", "inherit"] });

/** Before any long build, fail on a missing installation or a busy port with the fix. */
async function assertReadyToServe({ port, inboxPort, host }) {
  const missing = missingPrerequisite(root);
  if (missing) throw new Error(missing);
  await assertPortAvailable(port, "--port", host);
  await assertPortAvailable(inboxPort, "--inbox-port", host);
}

/** Create or reuse the synthetic state directory. */
function prepareFresh({ state, reset }) {
  if (reset) resetFreshState(state);
  return prepareFreshState(state);
}

/** Read a dump rehearsal's manifest, naming the command that creates it when it is absent. */
function readDumpManifest(manifestPath, state) {
  if (!fs.existsSync(manifestPath))
    throw new Error(
      `${state} holds no rehearsal. Run \`pnpm dev:rehearsal init --state <directory> --dump <backup.sql>\` first.`,
    );
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

async function main() {
  const options = parseRehearsalOptions(process.argv.slice(2));
  const { command, state, sql, port, inboxPort, fast, host, baseUrl } = options;
  const importing = command === "init" || command === "refresh";
  const manifestPath = path.join(state, "rehearsal.json");
  const configPath = path.join(state, "wrangler.json");
  const workerConfigPath = path.join(state, "worker.json");
  const envPath = path.join(state, ".rehearsal.vars");
  if (command === "fresh" || command === "start" || command === "refresh") await assertReadyToServe(options);
  const plans = options.plans ? agendaPlanFiles(options.plans) : [];
  const importToken = process.env.PKIC_AGENDA_IMPORT_TOKEN;
  if (plans.length && !importToken) throw new Error("--plans needs PKIC_AGENDA_IMPORT_TOKEN in the environment");
  if (command === "refresh" && fs.existsSync(state))
    throw new Error(`${state} already exists. Pass a new --state directory for each refresh.`);
  const fresh = command === "fresh" ? prepareFresh(options) : null;
  // The export only reads production; everything after it stays in the local state directory.
  const dump = command === "refresh" ? exportD1Backup("production", root) : options.dump;
  if (importing) {
    if (!fs.statSync(dump, { throwIfNoEntry: false })?.isFile()) throw new Error(`Dump must be a SQL file: ${dump}`);
    // Never overwrite a previous rehearsal, even after a partial import.
    if (fs.existsSync(state)) throw new Error(`${state} already exists. Pass a new --state directory for each import.`);
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.mkdirSync(state, { recursive: false, mode: 0o700 });
    fs.writeFileSync(manifestPath, JSON.stringify({ ready: false, signingSecret: randomBytes(32).toString("hex") }), {
      mode: 0o600,
    });
  }
  const manifest = fresh ? fresh.manifest : readDumpManifest(manifestPath, state);
  if (!importing && !fresh?.created && !manifest.ready)
    throw new Error("Import did not finish. Initialize a new state directory.");
  const database = rehearsalDatabaseConfig(root);
  fs.writeFileSync(configPath, JSON.stringify(database, null, 2), { mode: 0o600 });
  // Run the installed CLI with the isolated directory as cwd: pnpm exec
  // requires a package there and changing back to root could load local secrets.
  const wrangler = [path.join(root, "node_modules/wrangler/bin/wrangler.js")];
  const flags = ["--config", configPath, "--local", "--persist-to", state];
  if (fresh) {
    // Apply pending migrations on every start so a pulled branch keeps working; seed synthetic data once.
    runUnattended(process.execPath, [...wrangler, "d1", "migrations", "apply", "DB", ...flags], state);
    if (fresh.created) {
      run(process.execPath, freshSeedArguments(state));
      for (const file of freshFixtureFiles(root))
        run(process.execPath, [...wrangler, "d1", "execute", "DB", ...flags, "--file", file, "--yes"], state);
      writeFreshManifest(state, { ...manifest, ready: true });
    }
  }
  if (importing) {
    const copy = path.join(state, "import.sql");
    fs.copyFileSync(dump, copy, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(copy, 0o600);
    run(process.execPath, ["scripts/reorder-d1-dump.mjs", copy]);
    run(process.execPath, [...wrangler, "d1", "execute", "DB", ...flags, "--file", copy, "--yes"], state);
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, ready: true }), { mode: 0o600 });
    if (command === "init") {
      console.log(`Imported the dump locally into ${state}. No migrations or seeders ran.`);
      return;
    }
  }
  if (command === "refresh")
    runUnattended(process.execPath, [...wrangler, "d1", "migrations", "apply", "DB", ...flags], state);
  if (command === "migrate" || command === "apply") {
    const operation =
      command === "migrate"
        ? ["d1", "migrations", "apply", "DB", ...flags]
        : ["d1", "execute", "DB", ...flags, "--file", sql, "--yes"];
    run(process.execPath, [...wrangler, ...operation], state);
    return;
  }
  const serving = { state, port, inboxPort, host, baseUrl, signingSecret: manifest.signingSecret };
  const children = options.build
    ? prepareBuiltServer({ state, database, fast, fresh, serving, workerConfigPath, envPath, wrangler })
    : prepareWatchServer({ state, database, fresh, serving });
  const { createCaptureServer } = await import("./email-capture/server.mjs");
  const inbox = createCaptureServer({ applicationOrigin: baseUrl });
  await new Promise((resolve, reject) => {
    inbox.once("error", reject);
    inbox.listen(inboxPort, host, resolve);
  });
  if (!fresh)
    console.log(
      `Application: ${baseUrl}/portal/\nCaptured email: ${rehearsalInboxOrigin(serving)}/\nState retained at: ${state}\nNo migrations or seeders run on startup. Apply migrations explicitly before using routes that need the new schema.`,
    );
  // Run each plan asynchronously: this process also serves the inbox the import may email.
  const applyPlans = async () => {
    for (const plan of plans) {
      console.log(`Applying agenda plan ${plan}`);
      const child = spawn(process.execPath, agendaPlanArguments(plan, port, host), {
        cwd: root,
        env: { ...env, PKIC_AGENDA_IMPORT_TOKEN: importToken },
        stdio: "inherit",
      });
      const code = await new Promise((resolve, reject) => child.once("error", reject).once("exit", resolve));
      if (code !== 0) throw new Error(`${plan} exited with ${code}`);
    }
  };
  await serve(children, inbox, {
    port,
    inboxPort,
    state,
    fresh,
    baseUrl,
    host,
    onReady: plans.length ? applyPlans : undefined,
  });
}

/** Build the bundled Worker and site, snapshot both into the state directory, and serve the snapshot. */
function prepareBuiltServer({ state, database, fast, fresh, serving, workerConfigPath, envPath, wrangler }) {
  const outputs = rehearsalBuildOutputs(root);
  for (const stale of outputs.stale) fs.rmSync(stale, { recursive: true, force: true });
  for (const step of rehearsalBuildSteps(env, state, { fast, withoutR2Media: !fresh }))
    run(step.command, step.args, root, step.env);
  const bundle = readBundledWorker(outputs.worker);
  const worker = path.join(state, "worker");
  copyBundledWorker(outputs.worker, worker);
  fs.rmSync(path.join(state, "site"), { recursive: true, force: true });
  fs.cpSync(outputs.site, path.join(state, "site"), { recursive: true });
  const config = rehearsalWorkerConfig({ directory: worker, bundle, database }, serving);
  fs.writeFileSync(workerConfigPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.writeFileSync(envPath, serializeRehearsalVars(config.vars), { mode: 0o600 });
  const args = [
    ...wrangler,
    "dev",
    "--config",
    workerConfigPath,
    "--local",
    "--persist-to",
    state,
    "--ip",
    serving.host,
    "--port",
    String(serving.port),
    ...rehearsalEnvFiles(root, state).flatMap((file) => ["--env-file", file]),
  ];
  return [{ command: process.execPath, args, cwd: state, env }];
}

/** Publish the site from the state's database once, then hot-reload the Worker and portal from source. */
function prepareWatchServer({ state, database, fresh, serving }) {
  for (const step of rehearsalBuildSteps(env, state, { watch: true, withoutR2Media: !fresh }))
    run(step.command, step.args, root, step.env);
  const configPath = path.join(state, "wrangler.dev.json");
  fs.writeFileSync(configPath, JSON.stringify(rehearsalDevConfig(root, database), null, 2), { mode: 0o600 });
  // Wrangler prefers `.dev.vars.<environment>` over `.dev.vars`; keep only the generated file.
  fs.rmSync(path.join(state, ".dev.vars.local"), { force: true });
  fs.writeFileSync(path.join(state, ".dev.vars"), serializeRehearsalDevVars(root, serving), { mode: 0o600 });
  return rehearsalWatchProcesses(env, { root, configPath, state, port: serving.port, host: serving.host }).map(
    (child) => ({
      ...child,
      cwd: root,
    }),
  );
}

/** Run the server processes until Ctrl+C or until one exits on its own, then stop them all with the inbox. */
async function serve(processes, inbox, { port, inboxPort, state, fresh, baseUrl, host, onReady }) {
  const children = processes.map(({ command, args, cwd, env: childEnv }) =>
    spawn(command, args, { cwd, env: childEnv, stdio: "inherit" }),
  );
  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
    inbox.closeAllConnections();
    inbox.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const isRunning = () => !stopping && children.every((child) => child.exitCode === null);
  if (fresh || onReady)
    void waitForServer(`${rehearsalOrigin(host, port)}/api/v1/`, { isRunning }).then(async (ready) => {
      if (!ready) return;
      try {
        await onReady?.();
      } catch (error) {
        console.error(error.message);
        stop();
        process.exitCode = 1;
        return;
      }
      if (fresh) console.log(freshStartupSummary({ port, inboxPort, state, baseUrl, host }));
    });
  try {
    await Promise.race(
      children.map(
        (child) =>
          new Promise((resolve, reject) => {
            child.once("error", reject);
            // A server exits 143 after the SIGTERM that stop() sends; only an unrequested exit fails.
            child.once("exit", (code) =>
              code && !stopping ? reject(new Error(`Local server exited with ${code}`)) : resolve(),
            );
          }),
      ),
    );
  } finally {
    stop();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
