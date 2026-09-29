/**
 * Initials standing in for a portrait are one component, not one per surface.
 *
 * Issue #44 asked for bigger letters. Sizing them was the wrong fix and the
 * report was the symptom: six stylesheets drew an initials avatar, each
 * picking a font size by hand, and each landed on roughly 30% of its own
 * circle — so a stand-in for a face read as a mostly empty disc everywhere at
 * once. Four of the six had no markup left at all: their surfaces had become
 * Preact islands and the stylesheets stayed behind, so the letters were being
 * restyled on pages nothing rendered.
 *
 * Three functions answered "what are this name's initials", with three
 * answers — two letters, three letters, and three letters with every
 * non-ASCII character stripped, which mangles a name like Ó Súilleabháin.
 *
 * Both are checked here because both faults are quiet: nothing breaks when a
 * seventh copy appears, it simply looks slightly different and drifts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The components that own drawing initials. */
const OWNERS = new Set([
  "assets/ts/ui/Avatar.css", // a person's face
  "assets/ts/components/PictureTile.css", // an organization's logo
]);

/**
 * Surfaces that still draw their own, and why each one still does.
 *
 * This is an inventory, not an exemption: it exists so a *new* surface cannot
 * quietly become the seventh, and it shrinks as each entry migrates. Every
 * one of these is markup a Hugo template emits, so using the component means
 * making the surface an island first — a rendering change, not a restyle.
 *
 * Delete an entry when its surface moves to `Avatar`; the test then requires
 * the stylesheet to have stopped drawing initials.
 */
const TEMPLATE_RENDERED = new Map([
  // Blocked on the same question as the rest of the blog author work: a post
  // names its author as a display name with no organization beside it, so
  // answering it from D1 needs a public people-search across the membership
  // as of a date — a privacy decision, not a refactor (#8).
  ["assets/scss/_blog.scss", "blog author cards, blocked on #8's people-search question"],
  // The agenda is a shortcode over event front matter, not a fetched surface.
  ["assets/scss/_agenda.scss", "agenda speaker portraits, rendered by layouts/shortcodes/agenda.html"],
  // The member grid and profile hero, rendered by Preact but with the public
  // site's own `initial-color-N` palette rather than the design tokens.
  ["assets/scss/_bento.scss", "public member cards, pending the palette decision"],
  // The public person card: the one remaining Preact holdout. Swapping it to
  // `Avatar` changes the ring and the accent palette on published pages, so it
  // is a visual decision rather than a like-for-like migration.
  ["assets/scss/_leadership-cards.scss", "PublicPersonCard's accent ring, pending the palette decision"],
]);

/** The one module answering "what letters stand in for this picture". */
const CANONICAL = "assets/ts/shared/initials.ts";

function sourceFiles(dir: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(full);
  }
  return found;
}

describe("initials avatars", () => {
  it("are styled only by the components that own them", () => {
    const drawing = sourceFiles("assets", [".css", ".scss"])
      .map((file) => path.relative(".", file).replaceAll("\\", "/"))
      .filter((file) => !OWNERS.has(file))
      .filter((file) => /[.&-]initials?\b|initials-avatar|-initials\s*\{/.test(fs.readFileSync(file, "utf8")));

    expect(
      drawing.filter((file) => !TEMPLATE_RENDERED.has(file)),
      "a new surface is drawing its own initials avatar instead of using the component",
    ).toEqual([]);

    // And the inventory does not outlive what it describes: an entry whose
    // stylesheet has stopped drawing initials is a migration nobody recorded.
    expect(
      [...TEMPLATE_RENDERED.keys()].filter((file) => !drawing.includes(file)),
      "this surface no longer draws its own initials — remove it from the inventory",
    ).toEqual([]);
  });

  it("take their letters from one implementation", () => {
    const declarations = sourceFiles("assets", [".ts", ".tsx"])
      .map((file) => path.relative(".", file).replaceAll("\\", "/"))
      .filter((file) =>
        /export function (initials|monogram|memberInitials)\w*\s*\(/.test(fs.readFileSync(file, "utf8")),
      );

    expect(declarations).toEqual([CANONICAL]);
  });

  it("size the letters from the avatar's own diameter, not the text around it", () => {
    const stylesheet = fs.readFileSync(path.resolve("assets/ts/ui/Avatar.css"), "utf8");
    const rule = stylesheet.slice(stylesheet.indexOf(".pk-avatar__initials"));
    const fontSize = /font-size:\s*([^;]+);/.exec(rule)?.[1] ?? "";
    // `em` measured the inherited body size, so one nine-pixel size served
    // both a 2rem list marker and a 5.75rem portrait — which is #44 itself.
    expect(fontSize).toContain("var(--pk-avatar-size)");
    expect(fontSize).not.toMatch(/\d\s*em\b/);
  });
});
