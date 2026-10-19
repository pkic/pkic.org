import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stringify } from "yaml";
import { afterEach, expect, it } from "vitest";
import { agendaTransferDigest } from "../../assets/shared/event-agenda-transfer";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url";
import { contentPathToRoute, parseFrontMatter } from "../../functions/_lib/services/site-markdown";
import {
  authoredAgendaDownloadReferences,
  publishAuthoredAgendaDownloads,
} from "../../scripts/publication/publish-authored-agenda-downloads.mjs";
import {
  prepareDocumentRetirement,
  validateDocumentRoutes,
} from "../../scripts/publication/collect-document-redirects.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const agenda = agendaSnapshotSchema.parse({
  eventSlug: "canonical-event",
  timeZone: "UTC",
  revision: 1,
  publishedRevision: 1,
  rooms: [],
  shifts: [],
  roleMembers: [],
  assignments: [],
  occurrences: [],
});
async function fixture(presentation = "Exact file.pdf") {
  const root = await createTemporaryDirectory("authored-downloads");
  roots.push(root);
  const output = resolve(root, "output");
  const sourcePath = "content/events/2023/original/index.md";
  const data = { timezone: "UTC", agenda: { "2023-01-01": [{ time: "09:00", sessions: [{ presentation }] }] } };
  await mkdir(dirname(resolve(root, sourcePath)), { recursive: true });
  await writeFile(resolve(root, sourcePath), `---\n${stringify({ data })}---\nOriginal narrative\n`);
  const owner = {
    sourcePath,
    sourceDigest: await agendaTransferDigest(data),
    route: "/events/2023/original/",
    eventSlug: agenda.eventSlug,
  };
  const publication = { eventAgendas: { [agenda.eventSlug]: agenda }, authoredAgendaRoutes: [owner] };
  const bytes = Buffer.from("%PDF-1.7\nExact public baseline\u0000", "utf8");
  await writeFile(resolve(root, dirname(sourcePath), presentation), bytes);
  const staged = resolve(output, "content-media/events/2023/original", presentation);
  await mkdir(dirname(staged), { recursive: true });
  await writeFile(staged, bytes);
  return { root, output, sourcePath, owner, publication, bytes, staged };
}

it("retains exact authored PDF bytes despite a native agenda with no released materials, and replays", async () => {
  const value = await fixture();
  const expected = "events/2023/original/Exact file.pdf";
  expect(await publishAuthoredAgendaDownloads(value.output, value.publication, undefined, value.root)).toEqual([
    expected,
  ]);
  expect(await readFile(resolve(value.output, expected))).toEqual(value.bytes);
  expect(await publishAuthoredAgendaDownloads(value.output, value.publication, undefined, value.root)).toEqual([
    expected,
  ]);
  expect(value.publication.eventAgendas[agenda.eventSlug].occurrences).toEqual([]);
});

it("does not substitute NBSP or publish an unreferenced sponsor file", async () => {
  const value = await fixture();
  await rm(resolve(value.root, dirname(value.sourcePath), "Exact file.pdf"));
  await writeFile(resolve(value.root, dirname(value.sourcePath), "Exact\u00a0file.pdf"), value.bytes);
  await writeFile(resolve(value.root, dirname(value.sourcePath), "Sponsor.pdf"), value.bytes);
  expect(await authoredAgendaDownloadReferences(value.publication, value.root)).toEqual([]);
  expect(await publishAuthoredAgendaDownloads(value.output, value.publication, undefined, value.root)).toEqual([]);
  await expect(readFile(resolve(value.output, "events/2023/original/Exact file.pdf"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["draft", "digest", "route"])("refuses changed %s source ownership", async (change) => {
  const value = await fixture();
  if (change === "draft") {
    const text = await readFile(resolve(value.root, value.sourcePath), "utf8");
    await writeFile(resolve(value.root, value.sourcePath), text.replace("---\n", "---\ndraft: true\n"));
  } else if (change === "digest") value.owner.sourceDigest = "0".repeat(64);
  else value.owner.route = "/events/another/";
  await expect(authoredAgendaDownloadReferences(value.publication, value.root)).rejects.toThrow("source changed");
});

it.each(["staged", "destination"])("refuses conflicting %s bytes without overwriting", async (change) => {
  const value = await fixture();
  const target = resolve(value.output, "events/2023/original/Exact file.pdf");
  const conflicting = Buffer.from("%PDF-1.7\nDifferent bytes");
  if (change === "staged") await writeFile(value.staged, conflicting);
  else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, conflicting);
  }
  await expect(publishAuthoredAgendaDownloads(value.output, value.publication, undefined, value.root)).rejects.toThrow(
    change === "staged" ? "exact source file" : "collides",
  );
  if (change === "destination") expect(await readFile(target)).toEqual(conflicting);
});

it("refuses symlinked authored sources before copying any private bytes", async () => {
  const value = await fixture();
  const pdf = resolve(value.root, dirname(value.sourcePath), "Exact file.pdf");
  await rm(pdf);
  await symlink(value.staged, pdf);
  await expect(authoredAgendaDownloadReferences(value.publication, value.root)).rejects.toThrow("confined file");
});

it("lets an exact verified canonical document redirect safely supersede its old byte copies", async () => {
  const value = await fixture();
  const [reference] = await authoredAgendaDownloadReferences(value.publication, value.root);
  if (!reference) throw new Error("Expected the exact authored PDF reference");
  await publishAuthoredAgendaDownloads(value.output, value.publication, undefined, value.root);
  const digest = createHash("sha256").update(value.bytes).digest("hex");
  const canonical = sessionPresentationPublicUrl({
    eventSlug: agenda.eventSlug,
    occurrenceId: "1".repeat(32),
    versionId: "2".repeat(32),
    digest,
  });
  const routes = validateDocumentRoutes({
    version: 1,
    snapshotId: "a".repeat(64),
    sourceSequence: 1,
    redirects: [reference.url, reference.targetUrl].map((from) => ({ from, to: canonical, status: 302 })),
    retiredPaths: [reference.url, reference.targetUrl].map((from) => ({
      path: decodeURIComponent(from).slice(1),
      sha256: digest,
      bytes: value.bytes.length,
    })),
  });
  expect(await publishAuthoredAgendaDownloads(value.output, value.publication, routes, value.root)).toEqual([]);
  const retire = await prepareDocumentRetirement([value.output], routes);
  await retire();
  await expect(readFile(value.staged)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(resolve(value.output, decodeURIComponent(reference.url).slice(1)))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(resolve(value.root, dirname(value.sourcePath), "Exact file.pdf"))).toEqual(value.bytes);
  expect(routes.redirects).toHaveLength(2);
});

it("finds all 120 genuine exact references across the four authored histories, independently of native media", async () => {
  const paths = [
    "content/events/2023/pqc-conference-amsterdam-nl/index.md",
    "content/events/2025/pqc-conference-austin-us/index.md",
    "content/events/2025/pqc-conference-kuala-lumpur-my/_index.md",
    "content/events/2023/post-quantum-cryptography-conference/index.md",
  ];
  const owners = await Promise.all(
    paths.map(async (sourcePath) => {
      const { data } = parseFrontMatter(await readFile(sourcePath, "utf8"));
      return {
        sourcePath,
        sourceDigest: await agendaTransferDigest(data.data),
        route: contentPathToRoute(resolve(sourcePath), data),
        eventSlug: agenda.eventSlug,
      };
    }),
  );
  expect(owners.map(({ route }) => route)).toEqual([
    "/events/2023/pqc-conference-amsterdam-nl/",
    "/events/2025/pqc-conference-austin-us/",
    "/events/2025/pqc-conference-kuala-lumpur-my/",
    "/events/2023/post-quantum-cryptography-conference/",
  ]);
  const references = await authoredAgendaDownloadReferences({
    eventAgendas: { [agenda.eventSlug]: agenda },
    authoredAgendaRoutes: owners,
  });
  expect(references).toHaveLength(120);
  expect(new Set(references.map(({ url }) => url)).size).toBe(120);
  expect(
    references.filter(({ sourcePath }) => sourcePath.includes("post-quantum-cryptography-conference/")),
  ).toHaveLength(8);
  expect(
    references.every(
      ({ sourcePath, targetUrl }) =>
        decodeURIComponent(targetUrl.slice("/content-media/".length)) === sourcePath.slice("content/".length),
    ),
  ).toBe(true);
});
