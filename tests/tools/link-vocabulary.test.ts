/**
 * The gate under issue #13.
 *
 * The issue was reported as "YouTube and Facebook are raw URLs while LinkedIn
 * gets a badge", but the defect underneath it is that surfaces were allowed to
 * hold their own opinion about which platforms exist and what each one looks
 * like. Fixing the four platforms named in the issue would leave that intact.
 *
 * So this checks the property instead: nothing outside the shared reference
 * data may dress one platform differently from the rest, and the policy that
 * decides which profile URLs are acceptable may not accept a site the display
 * layer cannot name.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLinkLabel, LINK_HOSTS } from "../../assets/shared/schemas/links";
import { PROFESSIONAL_PROFILE_DOMAINS } from "../../assets/shared/schemas/form-field-rules";

const ROOT = process.cwd();
const STYLE_ROOTS = ["assets/scss", "assets/design", "assets/ts", "static"];

/** Brand colours. A stylesheet that names one has decided a platform is special. */
const BRAND_COLORS = [
  "#0077b5", // LinkedIn
  "#0a66c2", // LinkedIn (current)
  "#1da1f2", // Twitter
  "#1d9bf0", // X
  "#1877f2", // Facebook
  "#4267b2", // Facebook (legacy)
  "#e4405f", // Instagram
  "#ff0000", // YouTube
  "#6364ff", // Mastodon
];

/** A CSS class named after one platform, e.g. `.person-card-linkedin`. */
const PLATFORM_CLASS =
  /\.[a-z0-9_-]*(linkedin|twitter|facebook|youtube|instagram|bluesky|mastodon)[a-z0-9_-]*\s*[,{:]/i;

function styleFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(css|scss)$/.test(entry.name)) found.push(full);
    }
  };
  for (const root of STYLE_ROOTS) walk(path.join(ROOT, root));
  return found;
}

describe("one vocabulary for profile links", () => {
  const files = styleFiles();

  it("reads the stylesheets it is meant to be guarding", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("gives no platform a brand colour of its own", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8").toLowerCase();
      for (const color of BRAND_COLORS) {
        if (source.includes(color)) offenders.push(`${path.relative(ROOT, file)}: ${color}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives no platform a class of its own", () => {
    const offenders = files
      .filter((file) => PLATFORM_CLASS.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("can name every site the profile-URL policy accepts", () => {
    // Two lists that answer different questions — "may this be saved?" and
    // "what is this site called?" — but a domain in the first and not the
    // second is a link the form invites and the page renders as a bare host.
    const unnameable = PROFESSIONAL_PROFILE_DOMAINS.filter((domain) => !(domain in LINK_HOSTS));
    expect(unnameable).toEqual([]);
  });

  it("names every host in the shared table when it is given a URL on it", () => {
    for (const [hostname, host] of Object.entries(LINK_HOSTS)) {
      expect(getLinkLabel(`https://${hostname}/somebody`)).toBe(host.label);
      expect(getLinkLabel(`https://www.${hostname}/somebody`)).toBe(host.label);
    }
  });
});
