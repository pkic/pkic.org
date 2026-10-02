/**
 * A byline is what the page itself records.
 *
 * The migration used to resolve authors against today's `data/members` YAML;
 * the post's own `authorProfiles` front matter is the record now, and the build
 * only finds the files it names — the way Hugo's `blog/author-data.html` did.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBylines } from "../../scripts/lib/bylines.mjs";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function project(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "bylines-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

describe("bylines", () => {
  it("resolves a recorded profile's headshot, mark and links, and keeps an unrecorded author as a name", () => {
    const { bylines, images } = buildBylines(
      project({
        "assets/images/members/example/ada-lovelace.jpg": "",
        "assets/images/members/example/example.svg": "",
        "assets/images/members/example/unused.png": "",
        "content/blog/2024/post.md": `---
title: Post
authors:
  - Ada Lovelace
  - Grace Hopper
  - Ada Lovelace
authorProfiles:
  - name: Ada Lovelace
    organization: Example
    role: Engineer
    website: https://example.com/
    assetdirectory: images/members/example
    social:
      x: https://x.com/ada
      linkedin: https://www.linkedin.com/in/ada/
      twitter: http://insecure.example/ada
---
Body`,
        "content/blog/2024/no-authors.md": "---\ntitle: Nobody\n---\n",
      }),
    );

    expect(bylines).toEqual({
      "blog/2024/post": [
        {
          name: "Ada Lovelace",
          headshot: "/images/members/example/ada-lovelace.jpg",
          role: "Engineer",
          organization: {
            name: "Example",
            website: "https://example.com/",
            logo: "/images/members/example/example.svg",
          },
          links: ["https://x.com/ada", "https://www.linkedin.com/in/ada/"],
        },
        { name: "Grace Hopper" },
      ],
    });
    // Only what a byline shows is published, not the whole directory.
    expect(images).toEqual(["images/members/example/ada-lovelace.jpg", "images/members/example/example.svg"]);
  });
});
