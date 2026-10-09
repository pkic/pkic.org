import { access, readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { siteContentSecurityPolicy } from "../../assets/shared/site-security-policy";
import { PORTAL_OFFLINE_STATIC_ASSETS } from "../../assets/shared/schemas/portal-offline-assets";

const manifestPath = "static/portal/manifest.webmanifest";

function directive(policy: string, name: string) {
  return policy.split("; ").find((entry) => entry.startsWith(`${name} `));
}

it("links the installable portal's manifest and theme colour from the portal document head", async () => {
  const page = await readFile("site/pages/portal/index.astro", "utf8");
  const head = page.slice(page.indexOf('<Fragment slot="head">'), page.indexOf("</Fragment>"));
  expect(head).toContain('<link rel="manifest" href="/portal/manifest.webmanifest" />');
  expect(head).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}" \/>/);
  // The layout renders the slot inside <head>, where browsers look for a manifest.
  const layout = await readFile("site/layouts/PublicPage.astro", "utf8");
  const documentHead = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
  expect(documentHead).toContain('<slot name="head" />');
});

it("scopes the web app manifest to the portal and points at published brand icons", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    name: string;
    scope: string;
    start_url: string;
    display: string;
    theme_color: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
  };
  expect(manifest).toMatchObject({ name: "PKI Consortium", scope: "/portal/", start_url: "/portal/#/" });
  expect(manifest.display).toBe("standalone");
  const page = await readFile("site/pages/portal/index.astro", "utf8");
  expect(page).toContain(`content="${manifest.theme_color}"`);
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) await access(`static${icon.src}`);
  // Install prompts need raster icons at both standard sizes, rendered from the same artwork.
  for (const size of ["192x192", "512x512"])
    expect(manifest.icons.some((icon) => icon.type === "image/png" && icon.sizes === size)).toBe(true);
  for (const icon of manifest.icons.filter((entry) => entry.type === "image/png" && entry.sizes !== "180x180")) {
    const png = await readFile(`static${icon.src}`);
    const [width, height] = icon.sizes.split("x").map(Number);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width, height]);
  }
  // The installed app keeps its icons offline with the rest of its shell.
  for (const icon of manifest.icons) expect(PORTAL_OFFLINE_STATIC_ASSETS).toContain(icon.src);
  for (const icon of manifest.icons.filter((entry) => entry.type === "image/svg+xml")) {
    const svg = await readFile(`static${icon.src}`, "utf8");
    expect(svg).not.toMatch(/<script|<metadata|c2pa/i);
  }
});

it("lets only the portal fetch its own manifest", () => {
  expect(directive(siteContentSecurityPolicy("/portal/"), "manifest-src")).toBe("manifest-src 'self'");
  expect(directive(siteContentSecurityPolicy("/events/example/"), "manifest-src")).toBeUndefined();
});
