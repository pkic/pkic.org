import { afterEach, expect, it, vi } from "vitest";
import { publicationAllowsMissingMedia } from "../../scripts/publication/build-context.mjs";

afterEach(() => vi.unstubAllEnvs());

it("keeps missing-image failures as the default, including ordinary local publication", () => {
  vi.stubEnv("CLOUDFLARE_ENV", "local");
  vi.stubEnv("PKIC_PUBLICATION_ALLOW_MISSING_MEDIA", undefined);
  vi.stubEnv("PKIC_PUBLICATION_LOCAL_STATE", "/synthetic/rehearsal/v3");
  expect(publicationAllowsMissingMedia()).toBe(false);
});

it("permits image fallbacks only when explicitly enabled with isolated local state", () => {
  vi.stubEnv("CLOUDFLARE_ENV", "local");
  vi.stubEnv("PKIC_PUBLICATION_ALLOW_MISSING_MEDIA", "true");
  vi.stubEnv("PKIC_PUBLICATION_LOCAL_STATE", "/synthetic/rehearsal/v3");
  expect(publicationAllowsMissingMedia()).toBe(true);
  vi.stubEnv("PKIC_PUBLICATION_LOCAL_STATE", undefined);
  expect(() => publicationAllowsMissingMedia()).toThrow("explicit local rehearsal state");
});

it.each(["preview", "production"])("refuses missing-image fallbacks in %s", (environment) => {
  vi.stubEnv("CLOUDFLARE_ENV", environment);
  vi.stubEnv("PKIC_PUBLICATION_ALLOW_MISSING_MEDIA", "true");
  vi.stubEnv("PKIC_PUBLICATION_LOCAL_STATE", "/synthetic/rehearsal/v3");
  expect(() => publicationAllowsMissingMedia()).toThrow("explicit local rehearsal state");
});
