import path from "node:path";
import { rehearsalApplicationOrigin } from "./network.mjs";

/** The synthetic test environment's default state directory, relative to the repository. */
export const FRESH_STATE_DIRECTORY = ".local-test";

const USAGE = [
  "Usage:",
  "  pnpm dev:test [--build [--fast]] [--reset] [--port 8788] [--inbox-port 8799] [--host 127.0.0.1] [--base-url http://localhost:8788] [--state .local-test]",
  "  pnpm dev:rehearsal refresh --state <new directory> [--plans <directory>] [--build [--fast]] [--port 8788] [--inbox-port 8799] [--host 127.0.0.1] [--base-url <origin>]",
  "  pnpm dev:rehearsal <init|start|migrate|apply> --state <directory> [--dump <backup.sql>] [--sql <migration.sql>] [--build [--fast]] [--port 8788] [--inbox-port 8799] [--host 127.0.0.1] [--base-url <origin>]",
  "",
  "  refresh exports the latest production backup (read-only), imports it into a new state",
  "  directory, applies this branch's migrations, serves it, and then applies each reviewed",
  "  <event>/plan.json under --plans (set PKIC_AGENDA_IMPORT_TOKEN).",
  "",
  "  By default the server hot-reloads: Worker and portal changes apply in seconds.",
  "  --build  Serve the bundled Worker and built site instead, to check release parity",
  "           (prerendered pages, bundle size) before a push. Not for UI iteration.",
  "  --fast   With --build, build only what the portal and event pages need: original images",
  "           instead of responsive variants, no social card images or SVG optimization.",
  "           Diagrams render in every mode and reuse cached output when available.",
].join("\n");

export function parseRehearsalOptions(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const command = args.shift();
  if (!["fresh", "init", "start", "migrate", "apply", "refresh"].includes(command)) throw new Error(USAGE);
  const options = {
    command,
    reset: false,
    fast: false,
    build: false,
    state: command === "fresh" ? path.resolve(FRESH_STATE_DIRECTORY) : "",
    dump: "",
    sql: "",
    plans: "",
    port: 8788,
    inboxPort: 8799,
    host: "127.0.0.1",
    baseUrl: "",
  };
  const keys = {
    "--state": "state",
    "--dump": "dump",
    "--sql": "sql",
    "--plans": "plans",
    "--port": "port",
    "--inbox-port": "inboxPort",
    "--host": "host",
    "--base-url": "baseUrl",
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === "--help" || flag === "-h") throw new Error(USAGE);
    if (flag === "--reset") {
      if (command !== "fresh") throw new Error("Only fresh accepts --reset");
      options.reset = true;
      continue;
    }
    if (flag === "--fast" || flag === "--build") {
      if (!["fresh", "start", "refresh"].includes(command))
        throw new Error(`Only dev:test, start and refresh accept ${flag}`);
      options[flag.slice(2)] = true;
      continue;
    }
    const key = Object.hasOwn(keys, flag) ? keys[flag] : undefined;
    if (!key) throw new Error(`Unknown option: ${flag}`);
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[key] =
      key === "port" || key === "inboxPort"
        ? Number(value)
        : key === "host" || key === "baseUrl"
          ? value
          : path.resolve(value);
  }
  if (options.fast && !options.build) throw new Error("--fast applies only with --build; hot reload is already fast");
  if (!options.state) throw new Error("--state is required; use a dedicated local directory");
  if (command === "init" && !options.dump) throw new Error("init requires --dump");
  if (command === "apply" && !options.sql) throw new Error("apply requires --sql");
  if (command !== "init" && options.dump) throw new Error("Only init accepts --dump");
  if (command !== "apply" && options.sql) throw new Error("Only apply accepts --sql");
  if (command !== "refresh" && options.plans) throw new Error("Only refresh accepts --plans");
  for (const port of [options.port, options.inboxPort]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Ports must be between 1024 and 65535");
  }
  if (options.port === options.inboxPort) throw new Error("Application and inbox ports must differ");
  const listenOrigin = rehearsalApplicationOrigin(options);
  const base = new URL(options.baseUrl || listenOrigin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error("--base-url must be an HTTP(S) origin");
  options.baseUrl = base.origin;
  return options;
}
