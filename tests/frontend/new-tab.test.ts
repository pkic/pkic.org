import { describe, expect, it } from "vitest";
import { isExternalHref } from "../../assets/ts/ui/new-tab";

describe("isExternalHref", () => {
  const origin = "https://pkic.org";

  it("is true for absolute web addresses on another origin", () => {
    expect(isExternalHref("https://example.org/a", origin)).toBe(true);
    expect(isExternalHref("http://example.org", origin)).toBe(true);
    expect(isExternalHref("HTTPS://www.google.com", origin)).toBe(true);
    expect(isExternalHref("https://sub.pkic.org/", origin)).toBe(true);
  });

  it("is false for this origin, relative, hash, mail and phone links", () => {
    for (const href of [
      "https://pkic.org/portal/",
      "/portal/",
      "events/x",
      "#top",
      "?a=1",
      "mailto:a@b.c",
      "tel:+31",
      "",
      "https://",
    ]) {
      expect(isExternalHref(href, origin)).toBe(false);
    }
    expect(isExternalHref(undefined, origin)).toBe(false);
  });
});
