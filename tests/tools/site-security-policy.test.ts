import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  siteContentSecurityPolicy,
  siteStaticHeaders,
  siteSecurityHeaders,
} from "../../assets/shared/site-security-policy";

function directive(policy: string, name: string) {
  return policy.split("; ").find((entry) => entry.startsWith(`${name} `));
}

it("denies inline code, embedding, objects, and external API connections on ordinary public pages", () => {
  const policy = siteContentSecurityPolicy("/members/example/");
  expect(policy).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
  expect(directive(policy, "script-src-attr")).toBe("script-src-attr 'none'");
  expect(directive(policy, "style-src")).toBe("style-src 'self'");
  expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
  expect(directive(policy, "object-src")).toBe("object-src 'none'");
  expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
  expect(policy).not.toContain("mermaid");
  expect(policy).not.toContain("cdn.jsdelivr.net");
  expect(policy).not.toContain("stripe.com");
  expect(policy).not.toContain("pkic.github.io");
});

it("limits payment and assessment permissions to their canonical paths", () => {
  const payment = siteContentSecurityPolicy("/donate/");
  expect(directive(payment, "script-src")).toContain("https://js.stripe.com");
  expect(directive(payment, "connect-src")).toContain("https://api.stripe.com");
  expect(directive(payment, "frame-src")).toContain("https://hooks.stripe.com");
  expect(siteContentSecurityPolicy("/wg/pkimm/assessment/")).not.toContain("pkic.github.io");
  expect(siteContentSecurityPolicy("/wg/pkimm/1.0.0/tools/self-assessment/")).not.toContain("pkic.github.io");
  expect(directive(siteContentSecurityPolicy("/wg/pkimm/assessment/"), "style-src-elem")).toBe(
    "style-src-elem 'self' 'unsafe-inline'",
  );
  expect(directive(siteContentSecurityPolicy("/wg/pkimm/assessment/"), "style-src-attr")).toBe("style-src-attr 'none'");
  expect(siteContentSecurityPolicy("/wg/pkimm/assessment-other/")).not.toContain("pkic.github.io");
  expect(directive(siteContentSecurityPolicy("/questions.html"), "connect-src")).toBe("connect-src 'self'");
});

it("keeps native Cloudflare headers identical to the canonical policy and within platform line limits", async () => {
  const headers = await readFile("static/_headers", "utf8");
  expect(headers).toBe(siteStaticHeaders());
  const paths = headers.split("\n").filter((line) => line && !line.startsWith(" ") && !line.startsWith("#"));
  expect(new Set(paths).size).toBe(paths.length);
  expect(headers.split("\n").every((line) => line.length <= 2000)).toBe(true);
  expect(headers).toContain("Strict-Transport-Security: max-age=31536000");
  expect(headers).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()");
});

it("allows a first-party camera only in the portal scanner shell", () => {
  expect(siteSecurityHeaders("/portal/")["Permissions-Policy"]).toContain("camera=(self)");
  expect(siteSecurityHeaders("/events/example/")["Permissions-Policy"]).toContain("camera=()");
  const portalRule = siteStaticHeaders()
    .split("\n\n")
    .find((block) => block.startsWith("/portal/*\n"));
  expect(portalRule).toBe(
    `/portal/*\n    ! Content-Security-Policy\n    Content-Security-Policy: ${siteContentSecurityPolicy("/portal/")}\n    ! Permissions-Policy\n    Permissions-Policy: ${siteSecurityHeaders("/portal/")["Permissions-Policy"]}`,
  );
});

it("lets the portal's virtual room frame YouTube's privacy-enhanced player", () => {
  const frames = directive(siteContentSecurityPolicy("/portal/"), "frame-src")?.split(" ");
  expect(frames).toContain("https://www.youtube-nocookie.com");
  expect(frames).not.toContain("*");
});

it("lets the venue screen page load YouTube's player API, the portal only its loader and player files, and send its origin", async () => {
  const screen = siteContentSecurityPolicy("/live/screen/");
  expect(directive(screen, "script-src")?.split(" ")).toEqual([
    "script-src",
    "'self'",
    "'wasm-unsafe-eval'",
    "https://challenges.cloudflare.com",
    "https://www.youtube.com",
  ]);
  expect(directive(screen, "frame-src")).toContain("https://www.youtube-nocookie.com");
  for (const path of ["/live/overlay/", "/events/example/"])
    expect(directive(siteContentSecurityPolicy(path), "script-src")).not.toContain("youtube");
  // The studio's LIVE monitor uses the same API: the portal allows its loader and the player's files only.
  expect(
    directive(siteContentSecurityPolicy("/portal/"), "script-src")
      ?.split(" ")
      .filter((source) => source.includes("youtube")),
  ).toEqual(["https://www.youtube.com/iframe_api", "https://www.youtube.com/s/player/"]);
  expect(siteSecurityHeaders("/live/screen/")["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  const page = await readFile("site/pages/live/screen.astro", "utf8");
  expect(page).not.toMatch(/name="referrer" content="no-referrer"/u);
});

it("lets only the venue screen page reach its device's local metrics service", () => {
  expect(directive(siteContentSecurityPolicy("/live/screen/"), "connect-src")?.split(" ")).toEqual([
    "connect-src",
    "'self'",
    "http://127.0.0.1:8080",
  ]);
  for (const path of ["/", "/live/overlay/", "/portal/", "/donate/"])
    expect(directive(siteContentSecurityPolicy(path), "connect-src")).not.toContain("127.0.0.1");
});

it("allows email styling only in the isolated preview document", () => {
  const portal = siteContentSecurityPolicy("/portal/");
  expect(directive(portal, "style-src")).toBe("style-src 'self'");
  expect(directive(portal, "style-src-attr")).toBe("style-src-attr 'none'");
  expect(directive(portal, "frame-src")).toContain("'self'");
  const preview = siteSecurityHeaders("/email/preview/");
  const policy = preview["Content-Security-Policy"];
  expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  expect(directive(policy, "script-src")).toBe("script-src 'self'");
  expect(directive(policy, "script-src-attr")).toBe("script-src-attr 'none'");
  expect(directive(policy, "connect-src")).toBe("connect-src 'none'");
  expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'self'");
  expect(preview["X-Frame-Options"]).toBe("SAMEORIGIN");
  expect(siteContentSecurityPolicy("/email/preview/other")).not.toContain("'unsafe-inline'");
});

it("excludes public search responses from indexing without applying private cache policy", () => {
  expect(siteSecurityHeaders("/search/")["X-Robots-Tag"]).toBe("noindex, follow");
  expect(siteSecurityHeaders("/searching/")["X-Robots-Tag"]).toBeUndefined();
  const rule = siteStaticHeaders()
    .split("\n\n")
    .find((block) => block.startsWith("/search/*\n"));
  expect(rule).toContain("X-Robots-Tag: noindex, follow");
  expect(rule).not.toContain("Cache-Control");
});
