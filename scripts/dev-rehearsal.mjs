import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseRehearsalOptions, rehearsalMemberArguments } from "./rehearsal/options.mjs";
import {
  rehearsalConfig,
  rehearsalEnvironment,
  rehearsalEnvFiles,
  serializeRehearsalVars,
} from "./rehearsal/config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = rehearsalEnvironment(process.env);
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, env, stdio: "inherit" });

async function main() {
  const options = parseRehearsalOptions(process.argv.slice(2));
  const { command, state, dump, sql, port, inboxPort } = options;
  const manifestPath = path.join(state, "rehearsal.json");
  const configPath = path.join(state, "wrangler.json");
  const envPath = path.join(state, ".rehearsal.vars");
  if (command === "init") {
    if (!fs.statSync(dump).isFile()) throw new Error("Dump must be a SQL file");
    // Never overwrite a previous rehearsal, even after a partial import.
    fs.mkdirSync(state, { recursive: false, mode: 0o700 });
    fs.writeFileSync(manifestPath, JSON.stringify({ ready: false, signingSecret: randomBytes(32).toString("hex") }), {
      mode: 0o600,
    });
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (command !== "init" && !manifest.ready)
    throw new Error("Import did not finish. Initialize a new state directory.");
  if (command === "init" || command === "start") {
    const config = rehearsalConfig(root, state, port, inboxPort, manifest.signingSecret);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.writeFileSync(envPath, serializeRehearsalVars(config.vars), { mode: 0o600 });
  }
  // Run the installed CLI with the isolated directory as cwd: pnpm exec
  // requires a package there and changing back to root could load local secrets.
  const wrangler = [path.join(root, "node_modules/wrangler/bin/wrangler.js")];
  const flags = ["--config", configPath, "--local", "--persist-to", state];
  if (command === "init") {
    const copy = path.join(state, "import.sql");
    fs.copyFileSync(dump, copy, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(copy, 0o600);
    run(process.execPath, ["scripts/reorder-d1-dump.mjs", copy]);
    run(process.execPath, [...wrangler, "d1", "execute", "DB", ...flags, "--file", copy, "--yes"], state);
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, ready: true }), { mode: 0o600 });
    console.log(`Imported the dump locally into ${state}. No migrations or seeders ran.`);
    return;
  }
  if (command === "members") {
    run(process.execPath, rehearsalMemberArguments(options));
    return;
  }
  if (command === "migrate" || command === "apply") {
    const operation =
      command === "migrate"
        ? ["d1", "migrations", "apply", "DB", ...flags]
        : ["d1", "execute", "DB", ...flags, "--file", sql, "--yes"];
    run(process.execPath, [...wrangler, ...operation], state);
    return;
  }
  run(process.execPath, ["scripts/build-frontend.mjs", "--dev"]);
  execFileSync("hugo", ["--configDir=", "--baseURL=/", "-e", "development"], {
    cwd: root,
    env: { ...env, HUGO_PARAMS_SKIPREMOTEFEEDS: "true" },
    stdio: "inherit",
  });
  fs.rmSync(path.join(state, "site"), { recursive: true, force: true });
  fs.cpSync(path.join(root, "public"), path.join(state, "site"), { recursive: true });
  const { createCaptureServer } = await import("./email-capture/server.mjs");
  const inbox = createCaptureServer();
  await new Promise((resolve, reject) => {
    inbox.once("error", reject);
    inbox.listen(inboxPort, "127.0.0.1", resolve);
  });
  console.log(
    `Application: http://localhost:${port}/portal/\nCaptured email: http://127.0.0.1:${inboxPort}/\nState retained at: ${state}\nNo migrations or seeders run on startup. Apply migrations explicitly before using routes that need the new schema.`,
  );
  const child = spawn(
    process.execPath,
    [
      ...wrangler,
      "dev",
      ...flags,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      ...rehearsalEnvFiles(root, state).flatMap((file) => ["--env-file", file]),
    ],
    {
      cwd: state,
      env,
      stdio: "inherit",
    },
  );
  const stop = () => {
    child.kill("SIGTERM");
    inbox.closeAllConnections();
    inbox.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => (code ? reject(new Error(`Local server exited with ${code}`)) : resolve()));
    });
  } finally {
    stop();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
