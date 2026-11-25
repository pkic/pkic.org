/**
 * Seeds one event at production scale with synthetic people, plus a test
 * account per team member per event role. Re-running it converges on the same
 * rows. It never targets production: --remote is always the shared preview
 * database, and it writes there only with --apply.
 *
 * Usage: pnpm seed:preview-scale [--preview [--apply]] [--persist-to <dir>]
 *   [--event <slug>] [--create-event --name <name> --start <YYYY-MM-DD> [--days <n>] [--timezone <IANA>]]
 *   [--attendees <n>] [--speakers <n>] [--person <email>]...
 *   [--roster target|production|none] [--sql-out <file>] [--skip-headshots]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerLegacyAgendaSchemaResolution } from "./lib/legacy-agenda-runtime.mjs";
import { wranglerTargetArgs } from "./lib/wrangler-target.mjs";
import { sqlString } from "./lib/sql.mjs";

registerLegacyAgendaSchemaResolution();
const { buildPreviewScalePlan } = await import("./lib/preview-scale/plan.mjs");
const { seedStatements, headshotKey } = await import("./lib/preview-scale/statements.mjs");
const { initialsHeadshot } = await import("./lib/preview-scale/headshots.mjs");
const { TEAM_ROSTER_SQL, dedupeRoster } = await import("./lib/preview-scale/personas.mjs");
const { newEvent, newEventStatements } = await import("./lib/preview-scale/event.mjs");

const PREVIEW_HEADSHOT_BUCKET = "pkic-speaker-uploads-preview";
const USAGE =
  "Usage: pnpm seed:preview-scale [--preview [--apply]] [--persist-to <dir>] [--event <slug>] [--create-event --name <name> --start <YYYY-MM-DD> [--days <n>] [--timezone <IANA>]] [--attendees <n>] [--speakers <n>] [--person <email>]... [--roster target|production|none] [--sql-out <file>] [--skip-headshots]";

function parseArgs(argv) {
  const options = {
    target: "local",
    apply: false,
    persistTo: null,
    event: "pqc-conference-amsterdam-nl",
    attendees: 6000,
    speakers: 120,
    people: [],
    roster: "target",
    sqlOut: null,
    skipHeadshots: false,
    createEvent: false,
    name: null,
    start: null,
    dayCount: 3,
    timeZone: "Europe/Amsterdam",
  };
  const count = (value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 50_000) throw new Error(USAGE);
    return number;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const flag = {
      "--preview": ["target", "preview"],
      "--apply": ["apply", true],
      "--skip-headshots": ["skipHeadshots", true],
      "--create-event": ["createEvent", true],
    }[arg];
    if (flag) {
      options[flag[0]] = flag[1];
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(USAGE);
    index += 1;
    if (arg === "--persist-to") options.persistTo = value;
    else if (arg === "--event") options.event = value;
    else if (arg === "--attendees") options.attendees = count(value);
    else if (arg === "--speakers") options.speakers = count(value);
    else if (arg === "--person") options.people.push(value);
    else if (arg === "--name") options.name = value;
    else if (arg === "--start") options.start = value;
    else if (arg === "--days" && /^[1-7]$/.test(value)) options.dayCount = Number(value);
    else if (arg === "--timezone") options.timeZone = value;
    else if (arg === "--sql-out") options.sqlOut = value;
    else if (arg === "--roster" && ["target", "production", "none"].includes(value)) options.roster = value;
    else throw new Error(USAGE);
  }
  if (options.createEvent && (!options.name || !options.start))
    throw new Error("--create-event needs --name and --start.");
  if (options.target === "preview" && options.persistTo)
    throw new Error("--persist-to applies to the local database only.");
  return options;
}

function databaseArgs(target, persistTo) {
  if (target === "preview") return ["DB", ...wranglerTargetArgs("preview"), "--remote"];
  if (target === "production") return ["DB", ...wranglerTargetArgs("production"), "--remote"];
  return ["DB", ...wranglerTargetArgs("local"), "--local", ...(persistTo ? [`--persist-to=${persistTo}`] : [])];
}

function wrangler(args) {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Read-only query; the production roster read is the only production access this script has. */
function readRows(target, persistTo, sql) {
  const [result] = JSON.parse(
    wrangler(["d1", "execute", ...databaseArgs(target, persistTo), "--json", "--command", sql]),
  );
  if (!result?.success || !Array.isArray(result.results))
    throw new Error("D1 read did not return one successful result");
  return result.results;
}

function readEventContext(options) {
  const [row] = readRows(
    options.target,
    options.persistTo,
    `SELECT event.id AS eventId, event.timezone AS timeZone, event.ends_at AS eventEndsAt,
  COALESCE(json_extract(event.settings_json, '$.agenda.roomOrder'), '[]') AS roomOrder,
  (SELECT json_group_array(json_object('id', day.id, 'date', day.day_date)) FROM event_days day WHERE day.event_id = event.id) AS days,
  (SELECT id FROM users WHERE normalized_email = 'admin@pkic.org') AS adminUserId,
  (SELECT json_group_array(id) FROM roles WHERE id LIKE 'role-event_%' OR id = 'role-program_committee') AS roles,
  (SELECT json_group_array(json_object('id', room.id, 'name', room.name)) FROM event_agenda_rooms room WHERE room.event_id = event.id) AS rooms,
  (SELECT json_group_array(occurrence.id) FROM event_agenda_occurrences occurrence WHERE occurrence.event_id = event.id AND occurrence.visibility <> 'private') AS visibleOccurrenceIds
FROM (SELECT 1) LEFT JOIN events event ON event.slug = ${sqlString(options.event)}`,
  );
  const shared = { adminUserId: row.adminUserId, roles: new Set(JSON.parse(row.roles)) };
  if (!row.eventId) {
    if (!options.createEvent) throw new Error(`No event ${options.event} on the ${options.target} database.`);
    const event = newEvent({ slug: options.event, name: options.name, start: options.start, dayCount: options.dayCount, timeZone: options.timeZone });
    return { ...event, ...shared, create: newEventStatements(event) };
  }
  const days = JSON.parse(row.days).sort((left, right) => left.date.localeCompare(right.date));
  if (days.length === 0) throw new Error(`${options.event} has no event days.`);
  return {
    ...row,
    roomOrder: JSON.parse(row.roomOrder),
    days,
    ...shared,
    create: [],
    rooms: JSON.parse(row.rooms),
    visibleOccurrenceIds: JSON.parse(row.visibleOccurrenceIds),
  };
}

function readRoster(options) {
  const extra = options.people.map((email) => {
    const local = email.split("@")[0].split(/[._-]/u);
    const name = (part) => (part ? part[0].toUpperCase() + part.slice(1) : "Team");
    return { firstName: name(local[0]), lastName: name(local[1] ?? "member"), email };
  });
  if (options.roster === "none") return dedupeRoster(extra);
  const source = options.roster === "production" ? "production" : options.target;
  return dedupeRoster([...readRows(source, options.persistTo, TEAM_ROSTER_SQL), ...extra]);
}

async function uploadHeadshots(speakers, target, persistTo) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "pkic-preview-scale-headshots-"));
  try {
    for (const [index, speaker] of speakers.entries()) {
      if (!speaker.hasHeadshot) continue;
      const file = path.join(directory, `${speaker.userId}.webp`);
      fs.writeFileSync(file, await initialsHeadshot(speaker, index));
      const location =
        target === "preview" ? ["--remote"] : ["--local", ...(persistTo ? [`--persist-to=${persistTo}`] : [])];
      const bucket = target === "preview" ? PREVIEW_HEADSHOT_BUCKET : "pkic-speaker-uploads";
      wrangler([
        "r2",
        "object",
        "put",
        `${bucket}/${headshotKey(speaker.userId)}`,
        "--file",
        file,
        "--content-type",
        "image/webp",
        ...(target === "preview" ? ["--env", "production"] : ["--env", "local"]),
        ...location,
      ]);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function summarize(plan, context, options) {
  const seeded = new Set(plan.sessions.map((session) => session.id));
  const hidden = context.visibleOccurrenceIds.filter((id) => !seeded.has(id)).length;
  const reused = plan.rooms.filter((room) => room.existing).map((room) => room.name);
  const registered = plan.population.registrations.filter((registration) => registration.status === "registered");
  return [
    `${context.create.length ? "New event" : "Event"} ${options.event} (${context.days.length} days from ${context.days[0].date}, ${context.timeZone})`,
    `${plan.population.attendees.length} attendees, ${registered.length} registered, ${registered.filter((registration) => registration.badge).length} badges`,
    `${plan.sessions.length} agenda items, ${plan.population.speakers.length} speakers, ${plan.saved.length} saved sessions, ${plan.sponsorships.length} sponsorships`,
    `${hidden} existing public agenda items become private${reused.length ? `; reuses rooms ${reused.join(", ")}` : ""}`,
    `${plan.personas.length} persona accounts${plan.skippedRoles.length ? `; roles not on this database: ${plan.skippedRoles.join(", ")}` : ""}`,
  ].join("\n");
}

try {
  const options = parseArgs(process.argv.slice(2));
  const context = readEventContext(options);
  const plan = buildPreviewScalePlan({ ...options, context, roster: readRoster(options) });
  const statements = [
    ...context.create,
    ...seedStatements({ ...context, actorUserId: context.adminUserId ?? plan.population.speakers[0].userId }, plan),
  ];
  const scratch = options.sqlOut ? null : fs.mkdtempSync(path.join(tmpdir(), "pkic-preview-scale-"));
  const sqlPath = options.sqlOut ?? path.join(scratch, "seed.sql");
  fs.writeFileSync(sqlPath, `${statements.join("\n")}\n`);
  console.log(summarize(plan, context, options));
  console.log(`${statements.length} statements${options.sqlOut ? ` written to ${sqlPath}` : ""}`);
  if (options.target === "preview" && !options.apply) {
    console.log(
      "Review only. Pass --apply to write to the shared preview database; --sql-out keeps the SQL for review.",
    );
  } else {
    wrangler(["d1", "execute", ...databaseArgs(options.target, options.persistTo), "--file", sqlPath, "--yes"]);
    if (!options.skipHeadshots) await uploadHeadshots(plan.population.speakers, options.target, options.persistTo);
    console.log(`Seeded ${options.event} on the ${options.target} database.`);
  }
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
