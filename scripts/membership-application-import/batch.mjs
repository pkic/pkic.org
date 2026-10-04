import { z } from "zod";
import { digest, requestFor, unresolvedReason } from "./manifest.mjs";
import { importEntry } from "./database.mjs";

const states = [
  "ready",
  "pending",
  "in_flight",
  "imported",
  "already_present",
  "excluded",
  "unresolved",
  "failed",
  "uncertain",
];
const settled = new Set(["imported", "already_present", "excluded", "unresolved"]);

export function summarize(entries) {
  return Object.fromEntries(states.map((state) => [state, entries.filter((entry) => entry.status === state).length]));
}

function identity(manifest, entry, contracts) {
  return {
    sourceIssueNumber: entry.sourceIssueNumber,
    requestHash: digest(entry.decision === "import" ? requestFor(manifest, entry, contracts) : entry),
  };
}

export function createReport(manifest, contracts, execute) {
  const now = new Date().toISOString();
  const entries = manifest.entries.map((entry) => ({
    ...identity(manifest, entry, contracts),
    ...(unresolvedReason(entry) ? { reason: unresolvedReason(entry) } : {}),
    status:
      entry.decision === "import"
        ? unresolvedReason(entry)
          ? "unresolved"
          : execute
            ? "pending"
            : "ready"
        : entry.decision === "exclude"
          ? "excluded"
          : "unresolved",
    attempts: 0,
    updatedAt: now,
  }));
  return {
    version: 2,
    mode: execute ? "execute" : "dry-run",
    runId: manifest.runId,
    manifestHash: digest(manifest),
    destination: `${manifest.environment}:${manifest.databaseId}:${manifest.localDirectory ?? ""}`,
    createdAt: now,
    updatedAt: now,
    phase: execute ? "running" : "planned",
    summary: summarize(entries),
    entries,
  };
}

export function resumeReport(input, manifest, contracts) {
  const row = z
    .object({
      sourceIssueNumber: z.number().int().positive(),
      requestHash: z.string().regex(/^[a-f0-9]{64}$/),
      status: z.enum(states),
      attempts: z.number().int().nonnegative(),
      updatedAt: contracts.utcInstantSchema,
      resultId: contracts.databaseIdSchema.optional(),
      reason: z.string().max(100).optional(),
      error: z.enum(["source_changed", "identity_conflict", "interrupted", "operational_command"]).optional(),
    })
    .strict();
  const parsed = z
    .object({
      version: z.literal(2),
      mode: z.literal("execute"),
      runId: z.literal(manifest.runId),
      manifestHash: z.literal(digest(manifest)),
      destination: z.literal(`${manifest.environment}:${manifest.databaseId}:${manifest.localDirectory ?? ""}`),
      createdAt: contracts.utcInstantSchema,
      updatedAt: contracts.utcInstantSchema,
      phase: z.enum(["running", "complete", "incomplete", "interrupted"]),
      summary: z.record(z.enum(states), z.number().int().nonnegative()),
      entries: z.array(row),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success || parsed.data.entries.length !== manifest.entries.length)
    throw new Error("Resume requires an execution report for this exact reviewed manifest and destination");
  const report = parsed.data;
  report.entries.forEach((entry, index) => {
    const expected = identity(manifest, manifest.entries[index], contracts);
    const decision = manifest.entries[index].decision;
    if (
      entry.sourceIssueNumber !== expected.sourceIssueNumber ||
      entry.requestHash !== expected.requestHash ||
      (decision === "exclude" && entry.status !== "excluded") ||
      (decision === "unresolved" && entry.status !== "unresolved") ||
      (decision === "import" &&
        (unresolvedReason(manifest.entries[index])
          ? entry.status !== "unresolved"
          : ["ready", "excluded", "unresolved"].includes(entry.status))) ||
      (["imported", "already_present"].includes(entry.status) && !entry.resultId)
    )
      throw new Error("Resume report entries do not match the reviewed manifest");
  });
  report.summary = summarize(report.entries);
  return report;
}

/** Persist intent before database execution and the result afterward. An interrupted write can be safely replayed by source identity. */
export async function executeBatch({
  manifest,
  report,
  directory,
  save,
  signal,
  timeoutMs = 120_000,
  performImport = importEntry,
  onResult = () => {},
}) {
  report.phase = "running";
  const checkpoint = async () => {
    report.updatedAt = new Date().toISOString();
    report.summary = summarize(report.entries);
    await save(report);
  };
  await checkpoint();
  for (const [index, entry] of report.entries.entries()) {
    if (signal.aborted) break;
    if (settled.has(entry.status)) continue;
    entry.status = "in_flight";
    entry.attempts += 1;
    entry.updatedAt = new Date().toISOString();
    delete entry.error;
    delete entry.resultId;
    await checkpoint();
    const { stop, ...result } = await performImport({
      manifest,
      entry: manifest.entries[index],
      directory,
      timeoutMs,
      signal,
    });
    Object.assign(entry, result, { updatedAt: new Date().toISOString() });
    await checkpoint();
    onResult(entry);
    if (stop) break;
  }
  report.phase = signal.aborted
    ? "interrupted"
    : report.entries.every((entry) => ["imported", "already_present", "excluded"].includes(entry.status))
      ? "complete"
      : "incomplete";
  await checkpoint();
  return signal.aborted ? 130 : report.phase === "complete" ? 0 : 2;
}
