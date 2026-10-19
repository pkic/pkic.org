import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { rehearsalApplicationOrigin, rehearsalInboxOrigin } from "./network.mjs";
import { randomBytes } from "node:crypto";

/** The administrator that `scripts/seed-initial-admin.mjs` creates in every synthetic database. */
export const FRESH_ADMIN_EMAIL = "admin@pkic.org";
const MANIFEST = "rehearsal.json";
const FRESH_MODE = "fresh";

function readManifest(state) {
  try {
    return JSON.parse(fs.readFileSync(path.join(state, MANIFEST), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Name the first missing prerequisite with the command that fixes it, before any long step runs. */
export function missingPrerequisite(root) {
  if (!fs.existsSync(path.join(root, "node_modules/wrangler/bin/wrangler.js")))
    return "Dependencies are not installed. Run `pnpm install` in the repository first.";
  if (!fs.existsSync(path.join(root, "node_modules/.bin/vite")))
    return "The Vite build tool is missing. Run `pnpm install` in the repository first.";
  return null;
}

/** Fail early with the option that changes a busy port, instead of after a multi-minute build. */
export async function assertPortAvailable(port, option, host = "127.0.0.1") {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) =>
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `Port ${port} is already in use. Stop the other server or pass ${option} <port>.`
            : `Cannot listen on ${host}:${port}: ${error.message}`,
        ),
      ),
    );
    server.listen(port, host, () => server.close(resolve));
  });
}

/** Remove a state directory only when this synthetic mode created it; a dump rehearsal is never deleted. */
export function resetFreshState(state) {
  if (!fs.existsSync(state)) return;
  if (readManifest(state)?.mode !== FRESH_MODE)
    throw new Error(`Refusing to reset ${state}: it was not created by pnpm dev:test.`);
  fs.rmSync(state, { recursive: true, force: true });
}

/** Create or reuse the synthetic state directory and return its manifest with a locally generated secret. */
export function prepareFreshState(state) {
  const existing = fs.existsSync(state) ? readManifest(state) : null;
  if (existing) {
    if (existing.mode !== FRESH_MODE)
      throw new Error(`${state} holds a dump-based rehearsal. Pass another --state directory for synthetic data.`);
    if (!existing.ready)
      throw new Error("The previous setup did not finish. Run `pnpm dev:test --reset` to start again.");
    return { manifest: existing, created: false };
  }
  if (fs.existsSync(state) && fs.readdirSync(state).length > 0)
    throw new Error(`${state} is not empty and was not created by pnpm dev:test. Pass another --state directory.`);
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  // `ready` turns true only after migrations and seeding finish, so an interrupted setup is detected.
  const manifest = { mode: FRESH_MODE, ready: false, signingSecret: randomBytes(32).toString("hex") };
  writeFreshManifest(state, manifest);
  return { manifest, created: true };
}

export function writeFreshManifest(state, manifest) {
  fs.writeFileSync(path.join(state, MANIFEST), JSON.stringify(manifest), { mode: 0o600 });
}

/** Seed synthetic data only, through the shared local seed orchestrator, into the isolated state. */
export function freshSeedArguments(state) {
  return ["scripts/seed.mjs", "--local", "--skip-migrations", "--persist-to", state];
}

/**
 * The synthetic settings the browser suite applies after seeding: they put the fresh
 * database in the post-migration shape that the authored public pages reference.
 */
export function freshFixtureFiles(root) {
  return [path.join(root, "tests/fixtures/e2e-settings.sql")];
}

/** What a tester needs once the server answers: where to go and how to sign in. Never includes secrets. */
export function freshStartupSummary({ port, inboxPort, state, baseUrl = "", host = "127.0.0.1" }) {
  const app = baseUrl || rehearsalApplicationOrigin({ host, port });
  const inboxOrigin = rehearsalInboxOrigin({ host, inboxPort });
  return [
    "",
    "Local test environment is ready (synthetic data only; no email leaves this machine).",
    "",
    `  Portal:          ${app}/portal/`,
    `  Captured email:  ${inboxOrigin}/`,
    `  Website:         ${app}/`,
    `  State:           ${state}`,
    "",
    "Sign in:",
    `  1. Open the portal and request a sign-in link for ${FRESH_ADMIN_EMAIL} (the seeded administrator),`,
    "     or for any other address to try the experience of a new visitor.",
    "  2. Open the captured email inbox and follow the sign-in link in the newest message.",
    "",
    "Press Ctrl+C to stop. Run `pnpm dev:test` again to resume, or `pnpm dev:test --reset` to start over.",
    "",
  ].join("\n");
}

/** Poll until the local server answers, so the summary is the last thing the tester reads. */
export async function waitForServer(url, { attempts = 240, interval = 500, isRunning = () => true } = {}) {
  for (let attempt = 0; attempt < attempts && isRunning(); attempt += 1) {
    try {
      await fetch(url, { redirect: "manual" });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  return false;
}
