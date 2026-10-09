#!/usr/bin/env node
/**
 * Repeatable migration of one authored event agenda into the canonical agenda.
 *
 * A reviewed plan names the event, its authored source, the rooms to use (by exact
 * name) and the reviewed people mappings. The same plan can run against a fresh
 * database or one that was already migrated: rooms are reused by name, preparation
 * and review are rerun, and an applied archive or current transfer replays without changes.
 * Use "mode": "archive" for an event that has ended and "mode": "current" to migrate the
 * authored program of an upcoming or running event as its live agenda.
 * Plans and mappings hold canonical user IDs and stay outside the repository.
 *
 * Usage:
 *   PKIC_AGENDA_IMPORT_TOKEN=… node --experimental-strip-types scripts/migrate-event-agenda.mjs \
 *     --base-url <origin> --plan <plan.json> [--apply]
 *
 * Without --apply nothing is created or changed; missing rooms are reported.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerLegacyAgendaSchemaResolution } from "./lib/legacy-agenda-runtime.mjs";

registerLegacyAgendaSchemaResolution();
const { importPreparedAgenda } = await import("./lib/agenda-import-client.mjs");
const { agendaRoomCreateSchema, agendaSnapshotSchema } = await import("../assets/shared/schemas/event-agenda.ts");
const { agendaTransferModeSchema } = await import("../assets/shared/schemas/event-agenda-transfer.ts");
const { agendaTransferModePolicy } = await import("../assets/shared/event-agenda-transfer.ts");

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage =
  "Usage: node --experimental-strip-types scripts/migrate-event-agenda.mjs --base-url <origin> --plan <plan.json> [--apply]. Set PKIC_AGENDA_IMPORT_TOKEN in the environment.";

function parseArguments(args) {
  const values = new Map();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--apply") apply = true;
    else if (["--base-url", "--plan"].includes(name) && args[index + 1] && !args[index + 1].startsWith("--"))
      values.set(name, args[++index]);
    else throw new Error(usage);
  }
  if (!values.get("--base-url") || !values.get("--plan")) throw new Error(usage);
  return { baseUrl: new URL(values.get("--base-url")).origin, planPath: resolve(values.get("--plan")), apply };
}

async function loadPlan(planPath) {
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const relative = (path) => resolve(dirname(planPath), path);
  if (typeof plan.eventSlug !== "string" || typeof plan.sourcePath !== "string")
    throw new Error("The plan needs eventSlug and sourcePath.");
  if (!Array.isArray(plan.rooms) || plan.rooms.some((room) => !room?.sourceRoomRef || !room?.name))
    throw new Error("Every planned room needs sourceRoomRef and name.");
  if (!agendaTransferModeSchema.safeParse(plan.mode ?? "archive").success)
    throw new Error(`Unsupported import mode. Use ${agendaTransferModeSchema.options.join(", ")}.`);
  return {
    ...plan,
    mode: plan.mode ?? "archive",
    mappingsPath: relative(plan.mappingsPath),
    outputDirectory: relative(plan.outputDirectory ?? `./${plan.eventSlug}`),
  };
}

async function main() {
  const { baseUrl, planPath, apply } = parseArguments(process.argv.slice(2));
  const token = process.env.PKIC_AGENDA_IMPORT_TOKEN ?? "";
  if (!token) throw new Error("Supply the token through PKIC_AGENDA_IMPORT_TOKEN.");
  const plan = await loadPlan(planPath);
  await mkdir(plan.outputDirectory, { recursive: true });
  const save = (name, value) =>
    writeFile(resolve(plan.outputDirectory, name), JSON.stringify(value, null, 2), { mode: 0o600 });

  const source = await readFile(resolve(repositoryRoot, plan.sourcePath));
  const sourceDigest = createHash("sha256").update(source).digest("hex");
  if (plan.sourceDigest && plan.sourceDigest !== sourceDigest)
    throw new Error("The authored source changed since the plan was reviewed; refresh the plan.");

  const agendaUrl = `${baseUrl}/api/v1/events/${encodeURIComponent(plan.eventSlug)}/agenda`;
  async function api(suffix, body) {
    const response = await fetch(`${agendaUrl}${suffix}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
    });
    if (!response.ok) {
      let code = "REQUEST_FAILED";
      try {
        code = (await response.json())?.error?.code ?? code;
      } catch {
        /* Never report response contents. */
      }
      throw new Error(`Agenda request failed: HTTP ${response.status} ${code}`);
    }
    return agendaSnapshotSchema.parse(await response.json());
  }

  async function request(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
    });
    if (!response.ok) {
      let code = "REQUEST_FAILED";
      try {
        code = (await response.json())?.error?.code ?? code;
      } catch {
        /* Never report response contents. */
      }
      throw new Error(`Request failed: HTTP ${response.status} ${code} (${path.split("?")[0]})`);
    }
    return response.json();
  }

  // The event is found by slug, so plans never depend on a database's generated IDs.
  let eventId;
  if (plan.groupId) {
    const listed = await request(
      `/api/v1/groups/${encodeURIComponent(plan.groupId)}/events?q=${encodeURIComponent(plan.eventSlug)}&limit=100&offset=0`,
    );
    const matches = (listed.events ?? []).filter((event) => event.slug === plan.eventSlug);
    if (matches.length > 1) throw new Error(`More than one event has slug ${plan.eventSlug}.`);
    eventId = matches[0]?.id;
    if (!eventId && plan.createEvent) {
      if (!apply) {
        console.info(JSON.stringify({ step: "event", wouldCreate: plan.eventSlug }));
        console.info("Review only: rerun with --apply to create the event and continue.");
        return;
      }
      const body = JSON.parse(await readFile(resolve(dirname(planPath), plan.createEvent), "utf8"));
      if (body.slug !== plan.eventSlug) throw new Error("The event creation body names another slug.");
      eventId = (await request(`/api/v1/groups/${encodeURIComponent(plan.groupId)}/events`, body)).event.id;
    }
    if (!eventId) throw new Error(`Event ${plan.eventSlug} does not exist in group ${plan.groupId}.`);
  }

  // Rooms are matched by exact name so reruns and fresh databases converge on the same layout.
  let snapshot = await api("");
  const roomIds = {};
  const missingRooms = [];
  for (const planned of plan.rooms) {
    const matches = snapshot.rooms.filter((room) => room.name === planned.name);
    if (matches.length > 1) throw new Error(`More than one room is named ${planned.name}.`);
    if (matches.length) {
      roomIds[planned.sourceRoomRef] = matches[0].id;
      continue;
    }
    if (!apply) {
      missingRooms.push(planned.name);
      continue;
    }
    snapshot = await api(
      "/rooms",
      agendaRoomCreateSchema.parse({
        expectedRevision: snapshot.revision,
        name: planned.name,
        capacity: planned.capacity ?? null,
        setupMinutes: planned.setupMinutes ?? 0,
        equipment: planned.equipment ?? [],
        availablePeriods: planned.availablePeriods ?? [],
      }),
    );
    const created = snapshot.rooms.filter((room) => room.name === planned.name);
    if (created.length !== 1) throw new Error(`Room ${planned.name} was not created exactly once.`);
    roomIds[planned.sourceRoomRef] = created[0].id;
  }
  if (missingRooms.length) {
    console.info(JSON.stringify({ step: "rooms", wouldCreate: missingRooms }));
    console.info("Review only: rerun with --apply to create the rooms and continue.");
    return;
  }

  const mappings = JSON.parse(await readFile(plan.mappingsPath, "utf8"));
  if (mappings.event?.eventSlug !== plan.eventSlug) throw new Error("The mappings belong to another event.");
  const resolvedMappingsPath = resolve(plan.outputDirectory, "mappings.resolved.json");
  // Formats are checked against the target event's configured session types, read live.
  await save("mappings.resolved.json", {
    ...mappings,
    event: {
      ...mappings.event,
      ...(eventId ? { eventId } : {}),
      sessionTypes: (snapshot.formats ?? []).map((format) => format.id),
    },
    roomIds,
  });

  const documentPath = resolve(plan.outputDirectory, "agenda.json");
  const runScript = (script, args) =>
    spawnSync(process.execPath, ["--experimental-strip-types", resolve(repositoryRoot, "scripts", script), ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, PKIC_AGENDA_IMPORT_TOKEN: token },
    });
  const prepare = async (mappingsPath) => {
    const prepared = runScript("prepare-agenda-import.mjs", [
      resolve(repositoryRoot, plan.sourcePath),
      mappingsPath,
      documentPath,
    ]);
    if (prepared.status !== 0) throw new Error("Preparation failed; see its report.");
    const prepReport = JSON.parse(await readFile(`${documentPath}.report.json`, "utf8"));
    if (!prepReport.ready || prepReport.unresolved.length) throw new Error("Preparation has unresolved findings.");
    return prepReport;
  };
  let report = await prepare(resolvedMappingsPath);

  // Speaker portraits move to R2 (canonical headshots) before the import freezes them into credits.
  if (plan.headshots !== false) {
    const headshotMappingsPath = resolve(plan.outputDirectory, "mappings.headshots.json");
    const headshots = runScript("import-agenda-headshots.mjs", [
      "--report",
      `${documentPath}.report.json`,
      "--mappings",
      resolvedMappingsPath,
      "--repository-root",
      repositoryRoot,
      "--base-url",
      baseUrl,
      "--receipts",
      resolve(plan.outputDirectory, "headshots.receipts.json"),
      "--mappings-out",
      headshotMappingsPath,
      ...(apply ? ["--apply"] : []),
    ]);
    process.stdout.write(headshots.stdout);
    if (headshots.status !== 0) throw new Error(`Headshot migration failed: ${headshots.stderr.trim()}`);
    if (apply) report = await prepare(headshotMappingsPath);
  }
  if (plan.expectedOccurrences !== undefined && report.counts.occurrences !== plan.expectedOccurrences)
    throw new Error(`Expected ${plan.expectedOccurrences} occurrences, prepared ${report.counts.occurrences}.`);
  const documents = [];
  for (const output of report.outputs) documents.push(JSON.parse(await readFile(output.path, "utf8")));
  // The server only reports a generic schedule conflict; name the common event-window mismatch here.
  const outside = documents
    .flatMap((document) => document.occurrences)
    .filter(
      ({ timing }) =>
        (snapshot.eventStartsAt && timing.startAt && timing.startAt < snapshot.eventStartsAt) ||
        (snapshot.eventEndsAt && timing.endAt && timing.endAt > snapshot.eventEndsAt),
    )
    .map(({ fields, timing }) => `${timing.authoredDate} ${timing.authoredStart} ${fields.title}`);
  if (outside.length)
    throw new Error(
      `The event runs ${snapshot.eventStartsAt ?? "?"} to ${snapshot.eventEndsAt ?? "?"}, but these rows fall outside it: ${outside.join("; ")}. Align the event dates or the source first.`,
    );
  // Archive attribution can only be approved for sessions that already happened.
  if (plan.mode === "archive" && (!snapshot.eventEndsAt || Date.parse(snapshot.eventEndsAt) > Date.now()))
    throw new Error('The event has not ended yet; migrate it with "mode": "current" so its agenda can be approved.');

  const summaries = [];
  const run = (applyTransfer, parts = documents) =>
    importPreparedAgenda({
      baseUrl,
      eventSlug: plan.eventSlug,
      token,
      documents: parts,
      mode: plan.mode,
      apply: applyTransfer,
      acknowledgeInferredTiming: plan.acknowledgeInferredTiming === true,
      acknowledgeArchiveRepresentation: plan.acknowledgeArchiveRepresentation === true,
      onSummary: (summary) => {
        summaries.push(summary);
        console.info(JSON.stringify(summary));
      },
    });
  // Parts build on each other, so only the first part can be reviewed before applying.
  if (!apply) await run(false, documents.slice(0, 1));
  else {
    await run(true);
    if (agendaTransferModePolicy[plan.mode].retainsSource) {
      // A completed archive or current migration is idempotent: a second pass must change nothing.
      const replay = await run(true);
      if (replay.some((part) => part.imported !== 0)) throw new Error("Replaying the migration changed the agenda.");
    }
  }
  // Verified local slide PDFs become private draft material versions. Session IDs differ per
  // database, so the authored file -> session mapping is rebuilt from the export's source keys.
  let media = null;
  const presentations = documents
    .flatMap((document) => document.occurrences)
    .flatMap((row) =>
      row.media
        .filter((item) => item.kind === "presentation" && item.authoredReference)
        .map((item) => ({ authoredReference: item.authoredReference, sourceKey: row.sourceKey })),
    );
  if (apply && plan.media !== false && presentations.length && report.assets?.length) {
    const occurrenceBySourceKey = new Map();
    for (let offset = 0; ; offset += 100) {
      const page = await request(
        `/api/v1/events/${encodeURIComponent(plan.eventSlug)}/agenda/transfers/exports?limit=100&offset=${offset}`,
      );
      for (const row of page.occurrences) occurrenceBySourceKey.set(row.sourceKey, row.ref);
      if (!page.page?.hasMore) break;
    }
    const mediaMappings = {};
    for (const { authoredReference, sourceKey } of presentations) {
      const occurrenceId = occurrenceBySourceKey.get(sourceKey);
      if (!occurrenceId) throw new Error(`No imported session for slides ${authoredReference}.`);
      if (mediaMappings[authoredReference] && mediaMappings[authoredReference] !== occurrenceId)
        throw new Error(`Slides ${authoredReference} belong to more than one session.`);
      mediaMappings[authoredReference] = occurrenceId;
    }
    await save("media.mappings.json", mediaMappings);
    const uploaded = runScript("import-agenda-media.mjs", [
      "--report",
      `${documentPath}.report.json`,
      "--mappings",
      resolve(plan.outputDirectory, "media.mappings.json"),
      "--repository-root",
      repositoryRoot,
      "--base-url",
      baseUrl,
      "--event",
      plan.eventSlug,
      "--receipts",
      resolve(plan.outputDirectory, "media.receipts.json"),
      "--apply",
    ]);
    process.stdout.write(uploaded.stdout);
    if (uploaded.status !== 0) throw new Error(`Slide upload failed: ${uploaded.stderr.trim()}`);
    media = { presentations: Object.keys(mediaMappings).length };
  }

  const after = await api("");
  await save("receipt.json", {
    eventSlug: plan.eventSlug,
    sourcePath: plan.sourcePath,
    sourceDigest,
    mode: plan.mode,
    applied: apply,
    roomIds,
    occurrences: report.counts.occurrences,
    endMarkers: report.endMarkers ?? [],
    shadowedFragments: report.shadowedFragments?.length ?? 0,
    revision: after.revision,
    media,
    summaries,
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error && error.name === "Error" ? error.message : "Invalid migration plan or input.");
  process.exitCode = 1;
}
