import path from "node:path";

/**
 * Parses the options shared by the event and email-template seeders. A custom
 * handler returns the number of additional argv entries it consumed.
 */
export function parseSeedCliArgs(argv, defaults, handleCustomOption) {
  const parsed = {
    mode: "local",
    database: process.env.D1_DATABASE_NAME ?? "pkic-db",
    wranglerEnv: null,
    persistTo: null,
    ...defaults,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--remote" || arg === "--local") {
      parsed.mode = arg.slice(2);
      continue;
    }

    const commonValueKey = {
      "--db": "database",
      "--env": "wranglerEnv",
      "--bucket": "bucket",
      "--admin-email": "adminEmail",
      "--persist-to": "persistTo",
    }[arg];
    if (commonValueKey && next) {
      parsed[commonValueKey] = next;
      index += 1;
      continue;
    }

    if ((arg === "--config" || arg === "--file") && next) {
      parsed.configPath = path.isAbsolute(next) ? next : path.join(process.cwd(), next);
      index += 1;
      continue;
    }

    const consumed = handleCustomOption?.({ arg, next, parsed }) ?? 0;
    index += consumed;
  }

  return parsed;
}

/** Build the common Wrangler D1 execute prefix used by seed commands. */
export function buildWranglerD1ExecuteArgs({ database, wranglerEnv, mode, persistTo }) {
  return [
    "wrangler",
    "d1",
    "execute",
    database,
    ...(wranglerEnv ? ["--env", wranglerEnv] : []),
    mode === "remote" ? "--remote" : "--local",
    ...(persistTo ? [`--persist-to=${persistTo}`] : []),
  ];
}
