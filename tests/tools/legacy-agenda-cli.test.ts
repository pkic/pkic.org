import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { contentMediaUrl } from "../../assets/shared/content-media-url";
import { agendaTransferSchema } from "../../assets/shared/schemas/event-agenda-transfer";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

const repositoryRoot = process.cwd();
const entrypoint = resolve(repositoryRoot, "scripts/prepare-agenda-import.mjs");
const roots: string[] = [];
const reportSchema = z.object({
  sourcePath: z.string(),
  ready: z.boolean(),
  applied: z.literal(false),
  event: z.object({ state: z.enum(["mapped_unverified", "mapping_required"]), applied: z.literal(false) }),
  outputs: z.array(z.object({ path: z.string(), occurrences: z.number(), state: z.literal("prepared_not_applied") })),
  unresolved: z.array(z.object({ kind: z.string() }).passthrough()),
  counts: z.object({ occurrences: z.number() }),
  assets: z.array(z.object({ authoredReference: z.string() }).passthrough()),
});
const manifestSchema = z.object({ applied: z.literal(false), ready: z.boolean(), events: z.array(reportSchema) });
async function json(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function scratch(prefix?: string) {
  const root = await createTemporaryDirectory("legacy-agenda-cli", prefix);
  roots.push(root);
  return root;
}
function run(args: string[], cwd: string) {
  return JSON.parse(
    execFileSync(process.execPath, ["--experimental-strip-types", entrypoint, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30000,
    }).trim(),
  );
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("temporary historical agenda preparation CLI", () => {
  it("prepares actual sources from an unrelated cwd with stable provenance and honest unmapped manifests", async () => {
    const root = await scratch();
    const sourcePath = resolve(repositoryRoot, "content/events/2023/post-quantum-cryptography-conference/index.md");
    const mappingPath = join(root, "mappings.json");
    await writeFile(
      mappingPath,
      JSON.stringify({ publicBasePath: "/content-media/events/2023/post-quantum-cryptography-conference" }),
    );
    const batchPath = join(root, "batch.json");
    await writeFile(
      batchPath,
      JSON.stringify({
        events: [
          { sourcePath, mappingPath, outputName: "absolute" },
          { sourcePath: relative(root, sourcePath), mappingPath: "mappings.json", outputName: "relative" },
        ],
      }),
    );
    expect(run(["--batch", batchPath, join(root, "prepared")], root)).toMatchObject({
      events: 2,
      ready: false,
      applied: false,
    });
    const manifest = manifestSchema.parse(await json(join(root, "prepared/manifest.json")));
    expect(manifest.ready).toBe(false);
    const [first, second] = manifest.events;
    expect(first.sourcePath).toBe("content/events/2023/post-quantum-cryptography-conference/index.md");
    expect(second.sourcePath).toBe(first.sourcePath);
    expect(first.event.state).toBe("mapping_required");
    expect(first.unresolved.map((finding) => finding.kind)).toContain("event");
    expect(first.unresolved.map((finding) => finding.kind)).toContain("speaker");
    expect(first.unresolved.map((finding) => finding.kind)).toContain("historical_representation");
    expect(first.unresolved.some((finding) => finding.kind === "media")).toBe(false);
    expect(
      first.assets.some((asset) => asset.authoredReference === "pkic-pqcc-welcome-paul-van-brouwershaven.pdf"),
    ).toBe(true);
    const documents = await Promise.all(
      manifest.events.map(async (event) => agendaTransferSchema.parse(await json(event.outputs[0].path))),
    );
    // The last row of a day that only states a time marks when the day ends; it is not a session.
    expect(documents[0].occurrences).toHaveLength(13);
    const authoredSlide = "pkic-pqcc-welcome-paul-van-brouwershaven.pdf";
    const publishedSlideUrl = contentMediaUrl(`events/2023/post-quantum-cryptography-conference/${authoredSlide}`);
    expect(publishedSlideUrl).toBe(`/content-media/events/2023/post-quantum-cryptography-conference/${authoredSlide}`);
    expect(
      documents[0].occurrences.flatMap((row) => row.media).find((media) => media.authoredReference === authoredSlide)
        ?.publicUrl,
    ).toBe(publishedSlideUrl);

    expect(documents[1].occurrences.map((row) => row.sourceKey)).toEqual(
      documents[0].occurrences.map((row) => row.sourceKey),
    );
    expect(documents[1].source.sourceDigest).toBe(documents[0].source.sourceDigest);
    expect(documents[0].people.every((person) => person.canonicalUserId === null)).toBe(true);
    expect(
      documents[0].occurrences.every(
        (row) =>
          !row.archive?.appearances.length && !row.archive?.archivalCredits.length && !row.archive?.materials.length,
      ),
    ).toBe(true);
    expect(
      documents[0].occurrences
        .flatMap((row) => row.archive?.legacyFragments ?? [])
        .some((fragment) => fragment.anchor === "sessionModal-900-0-welcome"),
    ).toBe(true);
    expect(
      documents[0].occurrences.flatMap((row) => row.media).some((media) => media.publicUrl?.includes("start=1499")),
    ).toBe(true);
  }, 60000);

  it("emits independently valid bounded parts without claiming a mapped event was applied", async () => {
    const root = await scratch();
    const sourceRoot = await scratch(join(repositoryRoot, "tests/.legacy-agenda-cli-"));
    const sourcePath = join(sourceRoot, "agenda.yaml");
    const source = {
      data: {
        timezone: "Europe/Amsterdam",
        agenda: {
          "2026-12-01": [
            {
              time: "09:00",
              durationMinutes: 30,
              sessions: Array.from({ length: 101 }, (_, index) => ({
                id: `session-${index}`,
                title: `Synthetic ${index}`,
                locations: [],
                speakers: [],
              })),
            },
          ],
        },
      },
    };
    await writeFile(sourcePath, JSON.stringify(source));
    const mappings = join(root, "mappings.json");
    await writeFile(
      mappings,
      JSON.stringify({ event: { eventId: "11111111-1111-4111-8111-111111111111", eventSlug: "synthetic-event" } }),
    );
    const output = join(root, "agenda.json");
    expect(run([sourcePath, mappings, output], root)).toMatchObject({ occurrences: 101, ready: true, applied: false });
    const report = reportSchema.parse(await json(`${output}.report.json`));
    expect(report.event.state).toBe("mapped_unverified");
    expect(report.outputs.map((part) => part.occurrences)).toEqual([100, 1]);
    const parts = await Promise.all(
      report.outputs.map(async (part) => agendaTransferSchema.parse(await json(part.path))),
    );
    expect(new Set(parts.flatMap((part) => part.occurrences.map((row) => row.sourceKey))).size).toBe(101);
    expect(
      parts.every((part) => part.occurrences.every((row) => row.sourcePath === relative(repositoryRoot, sourcePath))),
    ).toBe(true);
    expect(report.unresolved).toEqual([]);
  }, 60000);

  it("retains an invalid mapping document for correction while refusing readiness", async () => {
    const root = await scratch();
    const sourceRoot = await scratch(join(repositoryRoot, "tests/.legacy-agenda-cli-"));
    const sourcePath = join(sourceRoot, "agenda.yaml");
    await writeFile(
      sourcePath,
      JSON.stringify({
        timezone: "Europe/Amsterdam",
        agenda: {
          "2026-12-01": [
            {
              time: "09:00",
              durationMinutes: 30,
              sessions: [{ title: "Synthetic", speakers: ["Explicit speaker"], locations: [] }],
            },
          ],
        },
      }),
    );
    const mappings = join(root, "mappings.json");
    await writeFile(mappings, JSON.stringify({ speakerUserIds: { "Explicit speaker": "invalid-canonical-id" } }));
    const output = join(root, "agenda.json");
    expect(run([sourcePath, mappings, output], root)).toMatchObject({ ready: false, applied: false });
    const report = reportSchema.parse(await json(`${output}.report.json`));
    expect(report.unresolved.some((finding) => finding.kind === "contract")).toBe(true);
    expect(agendaTransferSchema.safeParse(await json(output)).success).toBe(false);
  }, 60000);
});
