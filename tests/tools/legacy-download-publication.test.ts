import { createHash } from "node:crypto";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url";
import { validateDocumentRoutes } from "../../scripts/publication/collect-document-redirects.mjs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, expect, it } from "vitest";
import { publicDownloadPublisher } from "../../scripts/publication/publish-linked-downloads.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function release(
  filename = "Exact%20PDF.pdf",
  bytes = Buffer.from("%PDF-1.7\nSynthetic\u0000bytes\xff", "latin1"),
) {
  const root = await createTemporaryDirectory("legacy-download-publication");
  roots.push(root);
  const source = `/content-media/events/2023/example/${filename}`;
  await mkdir(resolve(root, "content-media/events/2023/example"), { recursive: true });
  await writeFile(resolve(root, decodeURIComponent(source).slice(1)), bytes);
  return { root, source, bytes, alias: `/events/2023/example/${filename}` };
}
function document(source: string, alias?: string) {
  return new JSDOM(`<a href="${source}"${alias ? ` data-legacy-download-url="${alias}"` : ""}>Slides</a>`);
}
it("copies only an explicit same-event legacy PDF alias with exact bytes and idempotent receipts", async () => {
  const { root, source, alias, bytes } = await release();
  const dom = document(source, alias);
  try {
    const publish = publicDownloadPublisher(root);
    expect(await publish(dom.window.document, "/events/2023/example/")).toEqual(["events/2023/example/Exact PDF.pdf"]);
    expect(await readFile(resolve(root, "events/2023/example/Exact PDF.pdf"))).toEqual(bytes);
    expect(await readFile(resolve(root, decodeURIComponent(source).slice(1)))).toEqual(bytes);
    expect(await publish(dom.window.document, "/events/2023/example/agenda/")).toEqual([
      "events/2023/example/Exact PDF.pdf",
    ]);
    expect(dom.window.document.querySelector("a")!.getAttribute("href")).toBe(source);
    expect(dom.window.document.querySelector("a")!.getAttribute("data-legacy-download-url")).toBe(alias);
  } finally {
    dom.window.close();
  }
});
it("does not derive old URLs from ordinary public content-media links", async () => {
  const { root, source } = await release();
  const dom = document(source);
  try {
    expect(await publicDownloadPublisher(root)(dom.window.document, "/events/2023/example/")).toEqual([]);
    await expect(readFile(resolve(root, "events/2023/example/Exact PDF.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    dom.window.close();
  }
});
it("refuses an unreviewed different filename without whitespace normalization", async () => {
  const { root, source } = await release("Verified%C2%A0name.pdf");
  const dom = document(source, "/events/2023/example/Reviewed%20name.pdf");
  try {
    await expect(publicDownloadPublisher(root)(dom.window.document, "/events/2023/example/")).rejects.toThrow(
      "exact public source filename",
    );
    await expect(readFile(resolve(root, "events/2023/example/Reviewed name.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(resolve(root, "events/2023/example/Verified name.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    dom.window.close();
  }
});
it("refuses different destination bytes rather than overwriting an existing URL", async () => {
  const { root, source, alias } = await release();
  await mkdir(resolve(root, "events/2023/example"), { recursive: true });
  await writeFile(resolve(root, "events/2023/example/Exact PDF.pdf"), "%PDF-other-existing-file");
  const dom = document(source, alias);
  try {
    await expect(publicDownloadPublisher(root)(dom.window.document, "/events/2023/example/")).rejects.toThrow(
      "collides",
    );
    expect(await readFile(resolve(root, "events/2023/example/Exact PDF.pdf"), "utf8")).toBe("%PDF-other-existing-file");
  } finally {
    dom.window.close();
  }
});
it.each([
  ["/content-media/events/2023/another/file.pdf", "/events/2023/example/file.pdf"],
  ["/api/v1/private/slides.pdf", "/events/2023/example/file.pdf"],
  ["https://example.test/slides.pdf", "/events/2023/example/file.pdf"],
  ["/content-media/events/2023/example/Exact%20PDF.pdf", "/events/2023/example/../file.pdf"],
  ["/content-media/events/2023/example/Exact%20PDF.pdf", "/events/2023/example/%2e%2e/file.pdf"],
  ["/content-media/events/2023/example/Exact%20PDF.pdf", "/events/2023/example/%2fetc.pdf"],
  ["/content-media/events/2023/example/Exact%20PDF.pdf", "/events/2023/example/file.pdf?token=private"],
])("rejects unsafe, cross-event or private alias inputs %s -> %s", async (source, alias) => {
  const { root } = await release();
  const dom = document(source, alias);
  try {
    await expect(publicDownloadPublisher(root)(dom.window.document, "/events/2023/example/")).rejects.toThrow();
  } finally {
    dom.window.close();
  }
});
it.each(["source-file", "source-parent", "destination-parent"])("rejects a %s symbolic link", async (kind) => {
  const { root, source, alias } = await release();
  const outside = await createTemporaryDirectory("legacy-download-outside");
  roots.push(outside);
  await writeFile(resolve(outside, "Exact PDF.pdf"), "%PDF-private-outside-staging");
  if (kind === "source-file") {
    await rm(resolve(root, decodeURIComponent(source).slice(1)));
    await symlink(resolve(outside, "Exact PDF.pdf"), resolve(root, decodeURIComponent(source).slice(1)));
  } else if (kind === "source-parent") {
    await rm(resolve(root, "content-media/events/2023/example"), { recursive: true });
    await symlink(outside, resolve(root, "content-media/events/2023/example"));
  } else {
    await mkdir(resolve(root, "events/2023"), { recursive: true });
    await symlink(outside, resolve(root, "events/2023/example"));
  }
  const dom = document(source, alias);
  try {
    await expect(publicDownloadPublisher(root)(dom.window.document, "/events/2023/example/")).rejects.toThrow(
      "symbolic links",
    );
  } finally {
    dom.window.close();
  }
});

it("skips bound canonical and generic copies while keeping unrelated source-only downloads", async () => {
  const { root, alias, source, bytes } = await release("Exact%C2%A0PDF.pdf");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const canonical = sessionPresentationPublicUrl({
    eventSlug: "destination-event",
    occurrenceId: "1".repeat(32),
    versionId: "2".repeat(32),
    digest,
  });
  const routes = validateDocumentRoutes({
    version: 1,
    snapshotId: "a".repeat(64),
    sourceSequence: 1,
    redirects: [alias, source].map((from) => ({ from, to: canonical, status: 302 })),
    retiredPaths: [alias, source].map((from) => ({
      path: decodeURIComponent(from).slice(1),
      sha256: digest,
      bytes: bytes.length,
    })),
  });
  await writeFile(resolve(root, "content-media/events/2023/example/Unrelated.pdf"), "%PDF-source-only");
  const dom = new JSDOM(
    `<a href="${canonical}" data-legacy-download-url="${alias}">Canonical</a><a href="${alias}">Old</a><a href="${source}" data-legacy-download-url="${alias}">Source</a><a href="/content-media/events/2023/example/Unrelated.pdf" data-legacy-download-url="/events/2023/example/Unrelated.pdf">Unrelated</a>`,
  );
  try {
    const publish = publicDownloadPublisher(root, routes);
    expect(await publish(dom.window.document, "/events/2023/example/agenda/")).toEqual([
      "events/2023/example/Unrelated.pdf",
    ]);
    expect(await readFile(resolve(root, "events/2023/example/Unrelated.pdf"), "utf8")).toBe("%PDF-source-only");
    await expect(readFile(resolve(root, decodeURIComponent(alias).slice(1)))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(root, decodeURIComponent(source).slice(1)))).toEqual(bytes);
    const link = dom.window.document.querySelector("a")!;
    link.setAttribute("href", source);
    await expect(publish(dom.window.document, "/events/2023/example/")).resolves.toEqual([
      "events/2023/example/Unrelated.pdf",
    ]);
    link.setAttribute("href", "/content-media/events/another/foreign.pdf");
    await expect(publish(dom.window.document, "/events/2023/example/")).rejects.toThrow("verified canonical redirect");
    link.setAttribute("href", canonical);
    dom.window.document.querySelectorAll("a")[1]!.setAttribute("href", alias.replace("Exact", "%45xact"));
    await expect(publish(dom.window.document, "/events/2023/example/")).rejects.toThrow("encoding conflicts");
  } finally {
    dom.window.close();
  }
});
