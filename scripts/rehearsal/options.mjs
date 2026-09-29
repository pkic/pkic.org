import path from "node:path";

export function parseRehearsalOptions(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const command = args.shift();
  if (!["init", "start", "migrate", "apply", "members"].includes(command)) {
    throw new Error(
      "Usage: pnpm dev:rehearsal <init|start|migrate|apply|members> --state <directory> [--dump <backup.sql>] [--sql <migration.sql>] [--port 8788] [--inbox-port 8799] [--roster-time-zone <IANA zone>] [--manual-mapping <approved.csv>]",
    );
  }
  const options = {
    command,
    state: "",
    dump: "",
    sql: "",
    port: 8788,
    inboxPort: 8799,
    rosterTimeZone: "",
    manualMappingPath: "",
  };
  const keys = {
    "--state": "state",
    "--dump": "dump",
    "--sql": "sql",
    "--port": "port",
    "--inbox-port": "inboxPort",
    "--roster-time-zone": "rosterTimeZone",
    "--manual-mapping": "manualMappingPath",
  };
  while (args.length) {
    const flag = args.shift();
    const key = Object.hasOwn(keys, flag) ? keys[flag] : undefined;
    if (!key) {
      const hint = flag === "--roster-timme-zone" ? "; use --roster-time-zone" : "";
      throw new Error(`Unknown option: ${flag}${hint}`);
    }
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[key] =
      key === "rosterTimeZone" ? value : key === "port" || key === "inboxPort" ? Number(value) : path.resolve(value);
  }
  if (command !== "members" && options.rosterTimeZone) throw new Error("Only members accepts --roster-time-zone");
  if (command !== "members" && options.manualMappingPath) throw new Error("Only members accepts --manual-mapping");
  if (!options.state) throw new Error("--state is required; use a dedicated local directory");
  if (command === "init" && !options.dump) throw new Error("init requires --dump");
  if (command === "apply" && !options.sql) throw new Error("apply requires --sql");
  if (command !== "init" && options.dump) throw new Error("Only init accepts --dump");
  if (command !== "apply" && options.sql) throw new Error("Only apply accepts --sql");
  for (const port of [options.port, options.inboxPort]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Ports must be between 1024 and 65535");
  }
  if (options.port === options.inboxPort) throw new Error("Application and inbox ports must differ");
  return options;
}

/** Arguments for the local-only member importer; preserve IANA names as values, not paths. */
export function rehearsalMemberArguments({ state, rosterTimeZone, manualMappingPath }) {
  return [
    "--experimental-strip-types",
    "scripts/migrate-members-yaml-to-d1.mjs",
    "--local",
    "--persist-to",
    state,
    "--out",
    path.join(state, "member-import"),
    ...(rosterTimeZone ? ["--roster-time-zone", rosterTimeZone] : []),
    ...(manualMappingPath ? ["--manual-mapping", manualMappingPath] : []),
  ];
}
