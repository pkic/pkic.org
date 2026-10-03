import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";
import { publicSocialCardPublisher } from "../../scripts/publication/publish-social-cards.mjs";
import { socialCardDescriptor } from "../../site/social-card";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";

const directories: string[] = [];

it("uses the member logo as the uncropped primary social asset", async () => {
  const publication = sitePublicationSnapshotSchema.parse(
    JSON.parse(await readFile("tests/fixtures/site-publication.json", "utf8")),
  );
  const member = publication.members[0];
  const card = socialCardDescriptor({ route: "/members/example-corp/", title: member.name, member, publication });
  expect(card.visual).toBe(member.logoUrl);
  expect(card.visualRound).toBe(false);
  const person = socialCardDescriptor({
    route: "/members/person/",
    title: member.name,
    member: { ...member, memberType: "H5" },
    publication,
  });
  expect(person.visualRound).toBe(true);
});
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function release() {
  const output = await mkdtemp(resolve(tmpdir(), "pkic-social-cards-"));
  directories.push(output);
  await mkdir(resolve(output, "img"));
  await writeFile(resolve(output, "img/logo.svg"), await readFile("static/img/logo.svg"));
  await writeFile(
    resolve(output, "img/photo.png"),
    await sharp({ create: { width: 640, height: 480, channels: 3, background: "#198754" } })
      .png()
      .toBuffer(),
  );
  return output;
}
function page(overrides: Record<string, unknown> = {}, privatePage = false) {
  const card = {
    route: "/example/",
    kind: "page",
    label: "PKI Consortium",
    title: "Trust through collaboration",
    description: "A global community advancing digital trust.",
    accent: "green",
    authors: [],
    leaders: [],
    logos: [],
    sponsors: [],
    ...overrides,
  };
  const document = new JSDOM(
    '<html><head><meta property="og:image" content="https://pkic.org/og/example/og.jpg"><meta name="twitter:image" content="https://pkic.org/og/example/og.jpg"></head><body></body></html>',
  );
  if (!privatePage) {
    const template = document.window.document.createElement("template");
    template.innerHTML = JSON.stringify(card);
    document.window.document.head.append(template);
    template.id = "pkic-social-card";
  }
  return document;
}

it("publishes supported JPEG metadata atomically, caches identical cards, and tracks changed source imagery", async () => {
  const output = await release();
  const publisher = await publicSocialCardPublisher(output);
  const original = page({ kind: "member", visual: "/img/photo.png" });
  const duplicate = page({ kind: "member", visual: "/img/photo.png" });
  try {
    await publisher.publish(original.window.document);
    await publisher.publish(duplicate.window.document);
    const card = publisher.manifest[0];
    expect(publisher.manifest[1].url).toBe(card.url);
    const bytes = await readFile(resolve(output, `.${card.url}`));
    const metadata = await sharp(bytes).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(["jpeg", 1200, 630]);
    expect(bytes.length).toBeLessThan(700_000);
    expect(original.window.document.querySelector('meta[name="pagefind:image"]')?.getAttribute("content")).toBe(
      "/img/photo.png",
    );
    expect(
      original.window.document.querySelector('meta[name="pagefind:image"]')?.getAttribute("data-pagefind-meta"),
    ).toBe("image[content]");
    expect(
      original.window.document.querySelector('meta[property="og:image"]')?.hasAttribute("data-pagefind-default-meta"),
    ).toBe(false);
    expect(original.window.document.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      `https://pkic.org${card.url}`,
    );
    expect(original.window.document.querySelector('meta[name="twitter:image:alt"]')?.getAttribute("content")).toContain(
      "Trust through collaboration",
    );
    expect(original.window.document.querySelector("#pkic-social-card")).toBeNull();
    await writeFile(
      resolve(output, "img/photo.png"),
      await sharp({ create: { width: 640, height: 480, channels: 3, background: "#dc3545" } })
        .png()
        .toBuffer(),
    );
    const next = await publicSocialCardPublisher(output);
    const updated = page({ kind: "member", visual: "/img/photo.png" });
    try {
      await next.publish(updated.window.document);
      expect(next.manifest[0].url).not.toBe(card.url);
      expect(await next.finish()).toContain(next.manifest[0].url.slice(1));
    } finally {
      updated.window.close();
    }
  } finally {
    original.window.close();
    duplicate.window.close();
  }
}, 15_000);

it("fits long titles inside the safe area without truncating them and excludes private cards", async () => {
  const output = await release();
  const publisher = await publicSocialCardPublisher(output);
  const long = page({
    kind: "working-group",
    title:
      "What Breaks Between Assessment and Implementation: Lessons from PQC Migration Programs Across Organizations",
    leaders: [
      { name: "Synthetic Chair", title: "Chair", organization: "Example Organization", photo: "/img/photo.png" },
    ],
  });
  const privatePage = page({}, true);
  try {
    await publisher.publish(long.window.document);
    await publisher.publish(privatePage.window.document);
    expect(publisher.manifest).toHaveLength(1);
    expect(publisher.manifest[0].bounds.y + publisher.manifest[0].bounds.height).toBeLessThanOrEqual(390);
    expect(publisher.manifest[0].fontSize).toBeLessThan(60);
    expect(publisher.manifest[0].alt).toContain("Across Organizations");
    expect(privatePage.window.document.querySelector('meta[property="og:image"]')).toBeNull();
  } finally {
    long.window.close();
    privatePage.window.close();
  }
}, 15_000);

it("refuses missing published imagery and API media instead of releasing a broken preview", async () => {
  const output = await release();
  const publisher = await publicSocialCardPublisher(output);
  for (const visual of ["/img/missing.png", "/api/v1/users/photo"]) {
    const document = page({ visual });
    try {
      await expect(publisher.publish(document.window.document)).rejects.toThrow();
    } finally {
      document.window.close();
    }
  }
  expect(publisher.manifest).toHaveLength(0);
});

it("ellipsizes exceptionally long visual titles while preserving full metadata", async () => {
  const publisher = await publicSocialCardPublisher(await release());
  const title = "Assessing cryptographic maturity across organizations and implementations ".repeat(20).trim();
  const document = page({ title, authors: [{ name: "Synthetic Author" }] });
  try {
    await publisher.publish(document.window.document);
    expect(publisher.manifest[0].truncated).toBe(true);
    expect(publisher.manifest[0].bounds.y + publisher.manifest[0].bounds.height).toBeLessThanOrEqual(360);
    expect(document.window.document.querySelector('meta[property="og:image:alt"]')?.getAttribute("content")).toContain(
      title,
    );
  } finally {
    document.window.close();
  }
}, 15_000);

it("bounds large vector logos while retaining the SVG as the member search asset", async () => {
  const output = await release();
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25000 12000"><rect width="25000" height="12000" fill="green"/></svg>';
  await writeFile(resolve(output, "img/large-logo.svg"), source);
  const publisher = await publicSocialCardPublisher(output);
  const document = page({ kind: "member", visual: "/img/large-logo.svg" });
  try {
    await publisher.publish(document.window.document);
    const card = publisher.manifest[0];
    const metadata = await sharp(await readFile(resolve(output, card.url.slice(1)))).metadata();
    expect([metadata.width, metadata.height]).toEqual([1200, 630]);
    expect(document.window.document.querySelector('meta[name="pagefind:image"]')?.getAttribute("content")).toBe(
      "/img/large-logo.svg",
    );
    expect(await readFile(resolve(output, "img/large-logo.svg"), "utf8")).toBe(source);
  } finally {
    document.window.close();
  }
});
