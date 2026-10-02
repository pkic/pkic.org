import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { publicDownloadPublisher } from "../../scripts/publication/publish-linked-downloads.mjs";

it("publishes linked bundle downloads at their authored URLs without changing external or missing links", async () => {
  const output = await mkdtemp(resolve(tmpdir(), "pkic-downloads-"));
  const dom = new JSDOM(
    '<a href="../brochure.pdf">Brochure</a><a href="https://example.org/report.pdf">External</a><a href="missing.pdf">Missing</a>',
  );
  try {
    await mkdir(resolve(output, "content-media/sponsors"), { recursive: true });
    await writeFile(resolve(output, "content-media/sponsors/brochure.pdf"), "%PDF-synthetic");
    const publish = publicDownloadPublisher(output);
    expect(await publish(dom.window.document, "/sponsors/sponsor/")).toEqual(["sponsors/brochure.pdf"]);
    expect(await readFile(resolve(output, "sponsors/brochure.pdf"), "utf8")).toBe("%PDF-synthetic");
    expect(dom.window.document.querySelector("a")?.getAttribute("href")).toBe("../brochure.pdf");
    expect(await publish(dom.window.document, "/sponsors/sponsor/")).toEqual(["sponsors/brochure.pdf"]);
    await expect(readFile(resolve(output, "sponsors/sponsor/missing.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    dom.window.close();
    await rm(output, { recursive: true, force: true });
  }
});

it("publishes required assessment data and configuration at their relative bundle URLs", async () => {
  const output = await mkdtemp(resolve(tmpdir(), "pkic-downloads-"));
  const dom = new JSDOM('<div data-self-assessment data-data-url="data.yaml" data-config-url="config.yaml"></div>');
  try {
    const bundle = "wg/pkimm/1.0.0/tools/self-assessment";
    await mkdir(resolve(output, "content-media", bundle), { recursive: true });
    await writeFile(resolve(output, "content-media", bundle, "data.yaml"), "categories: []");
    const publish = publicDownloadPublisher(output);
    await expect(publish(dom.window.document, `/${bundle}/`)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(resolve(output, "content-media", bundle, "config.yaml"), "title: Assessment");
    const files = await publish(dom.window.document, `/${bundle}/`);
    expect(files).toContain(`${bundle}/data.yaml`);
    expect(files).toContain(`${bundle}/config.yaml`);
    expect(await readFile(resolve(output, bundle, "config.yaml"), "utf8")).toBe("title: Assessment");
  } finally {
    dom.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
