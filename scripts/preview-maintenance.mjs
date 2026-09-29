import { readFileSync } from "node:fs";
import { maintenanceScheduleSchema } from "../assets/shared/schemas/availability.ts";

const file = process.argv[2];
if (!file) throw new Error("Usage: pnpm maintenance:preview <schedule.json>");
const schedule = maintenanceScheduleSchema.parse(JSON.parse(readFileSync(file, "utf8")));
const now = new Date().toISOString();
for (const window of [...schedule.windows].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
  const state = !window.enabled ? "canceled" : window.endsAt <= now ? "ended" : window.startsAt > now ? "upcoming" : "active";
  console.log(`${window.id}: ${state}, ${window.policy}, ${window.channels.join(", ")}`);
  console.log(`  ${window.startsAt} to ${window.endsAt}: ${window.message}`);
}
console.log("Validated deployment snapshot for MAINTENANCE_SCHEDULE:");
console.log(JSON.stringify(schedule));
