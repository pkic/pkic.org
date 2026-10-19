import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import path from "node:path";
import {
  publicationCacheDirectory,
  publicationFastLocalBuild,
  publicationOmitsMissingR2Media,
} from "../../scripts/publication/build-context.mjs";
import { omittedSocialCardPublisher } from "../../scripts/publication/publish-social-cards.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local-only publication options", () => {
  it.each([
    ["PKIC_PUBLICATION_FAST", "1", publicationFastLocalBuild],
    ["PKIC_PUBLICATION_MISSING_R2_MEDIA", "omit", publicationOmitsMissingR2Media],
  ] as const)("%s applies to a local publication and is refused elsewhere", (name, value, enabled) => {
    vi.stubEnv("CLOUDFLARE_ENV", "local");
    vi.stubEnv(name, undefined);
    expect(enabled()).toBe(false);
    vi.stubEnv(name, value);
    expect(enabled()).toBe(true);
    vi.stubEnv(name, "yes");
    expect(() => enabled()).toThrow(`Invalid ${name} value`);
    vi.stubEnv(name, value);
    for (const environment of ["preview", "production"]) {
      vi.stubEnv("CLOUDFLARE_ENV", environment);
      expect(() => enabled()).toThrow("applies only to a local publication");
    }
    vi.stubEnv("CLOUDFLARE_ENV", undefined);
    vi.stubEnv("WORKERS_CI_BRANCH", "main");
    expect(() => enabled()).toThrow("applies only to a local publication");
  });

  it("keeps fast builds in their own cache so their pages never enter a complete build", () => {
    vi.stubEnv("CLOUDFLARE_ENV", "local");
    vi.stubEnv("WORKERS_CI_BRANCH", undefined);
    vi.stubEnv("PKIC_PUBLICATION_FAST", undefined);
    const complete = publicationCacheDirectory("publication-social");
    vi.stubEnv("PKIC_PUBLICATION_FAST", "1");
    const fast = publicationCacheDirectory("publication-social");
    expect(complete).toBe(path.resolve("node_modules/.astro/publication/local/publication-social"));
    expect(fast).toBe(path.resolve("node_modules/.astro/publication/local-fast/publication-social"));
  });
});

describe("fast local publication", () => {
  it("publishes pages without social card images or their metadata", async () => {
    const { window } = new JSDOM(
      `<head><meta property="og:image" content="/og.jpg"><meta property="og:image:alt" content="Card">
      <meta name="twitter:image" content="/og.jpg"><meta property="og:title" content="Title"></head>
      <body><template id="pkic-social-card">{"title":"Title"}</template></body>`,
    );
    const publisher = omittedSocialCardPublisher();
    await publisher.publish(window.document);
    expect(window.document.querySelector("#pkic-social-card")).toBeNull();
    expect(window.document.querySelector('meta[property^="og:image"], meta[name="twitter:image"]')).toBeNull();
    expect(window.document.querySelector('meta[property="og:title"]')).not.toBeNull();
    expect(publisher.manifest).toEqual([]);
    expect(await publisher.finish()).toEqual([]);
  });
});
