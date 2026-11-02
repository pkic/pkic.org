import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "../../scripts/membership-application-import/manifest.mjs";
import { databaseArguments, importEntry } from "../../scripts/membership-application-import/database.mjs";
import { createReport, resumeReport } from "../../scripts/membership-application-import/batch.mjs";
import { sourceId } from "../../scripts/membership-application-import/sql.mjs";
import { contracts, databaseId, reviewedManifest } from "./helpers/application-import-fixtures";

const previewDatabaseId = "0647ba62-4bf0-40e5-b547-62f992acbbf0";
function previewManifest() {
  return { ...reviewedManifest(), environment: "preview", databaseId: previewDatabaseId, sourceData: "synthetic" };
}

describe("application backfill destinations", () => {
  it("refuses private evidence in preview", () => {
    const environment = "preview";
    const input = { ...reviewedManifest("/tmp/example"), environment, sourceData: "private" };
    expect(() => parseManifest(input, contracts, databaseId)).toThrow("synthetic");
  });
  it("requires an explicit local path and rejects local paths on remote targets", () => {
    expect(() =>
      parseManifest({ ...reviewedManifest(), environment: "local", sourceData: "synthetic" }, contracts, databaseId),
    ).toThrow("directory");
    for (const environment of ["production", "preview"])
      expect(() => parseManifest({ ...reviewedManifest("/tmp/example"), environment }, contracts, databaseId)).toThrow(
        "Remote",
      );
  });
  it("pins preview to its configured database rather than the production binding", () => {
    expect(() => parseManifest(previewManifest(), contracts, databaseId)).toThrow("Destination");
    expect(parseManifest(previewManifest(), contracts, previewDatabaseId).environment).toBe("preview");
  });
  it.each([
    ["local", ["--local", "--persist-to", "/tmp/example"]],
    ["preview", ["--remote"]],
    ["production", ["--remote"]],
  ])("routes %s explicitly without falling back to another database", (environment, flags) => {
    expect(databaseArguments({ environment, localDirectory: "/tmp/example" })).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--env",
      environment === "preview" ? "production" : environment,
      ...(environment === "preview" ? ["--preview"] : []),
      ...flags,
      "--json",
    ]);
  });
  it("does not resume a report against a different environment or local database", () => {
    const local = parseManifest(reviewedManifest("/tmp/first"), contracts, databaseId);
    const report = createReport(local, contracts, true);
    expect(() => resumeReport(report, { ...local, localDirectory: "/tmp/second" }, contracts)).toThrow();
    expect(() =>
      resumeReport(report, parseManifest(previewManifest(), contracts, previewDatabaseId), contracts),
    ).toThrow();
  });
  it.each(["local", "preview", "production"])(
    "executes %s from reviewed JSON without GitHub access",
    async (environment) => {
      const input =
        environment === "preview"
          ? previewManifest()
          : { ...reviewedManifest(environment === "local" ? "/tmp/example" : undefined), sourceData: "private" };
      const manifest = parseManifest(input, contracts, environment === "preview" ? previewDatabaseId : databaseId);
      const entry = manifest.entries[0];
      if (entry.decision !== "import") throw new Error("Expected reviewed fixture");
      const directory = await mkdtemp(join(tmpdir(), "backfill-preview-routing-"));
      let written = false;
      const command = vi.fn(async (name: string, args: string[]) => {
        expect(name).toBe("pnpm");
        const expectedArguments = databaseArguments(manifest);
        expect(args.slice(0, expectedArguments.length)).toEqual(expectedArguments);
        if (args.includes("--file")) {
          const sql = await readFile(args[args.indexOf("--file") + 1], "utf8");
          expect(sql).toContain("Example User");
          expect(sql).toContain("INSERT INTO member_applications");
          written = true;
          return "[]";
        }
        return JSON.stringify([
          { success: true, results: written ? [{ id: sourceId(entry.source), source_note: 1 }] : [] },
        ]);
      });
      try {
        expect(
          await importEntry({ manifest, entry, directory, signal: new AbortController().signal, command }),
        ).toMatchObject({ status: "imported", resultId: sourceId(entry.source) });
        expect(command).toHaveBeenCalledTimes(3);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
