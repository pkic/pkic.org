import fs from "node:fs";
import { rehearsalOrigin } from "./network.mjs";
import path from "node:path";

/** Reviewed agenda migration plans, one `<event>/plan.json` per directory, in name order. */
export function agendaPlanFiles(directory) {
  const plans = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(directory, entry.name, "plan.json"))
    .filter((plan) => fs.existsSync(plan))
    .sort();
  if (!plans.length) throw new Error(`${directory} holds no <event>/plan.json`);
  return plans;
}

/** Apply one plan to the local rehearsal server; the plan stays outside the repository. */
export function agendaPlanArguments(plan, port, host = "127.0.0.1") {
  return [
    "--experimental-strip-types",
    "scripts/migrate-event-agenda.mjs",
    "--base-url",
    rehearsalOrigin(host, port),
    "--plan",
    plan,
    "--apply",
  ];
}
