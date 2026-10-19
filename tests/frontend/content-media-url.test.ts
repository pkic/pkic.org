import { describe, expect, it } from "vitest";
import { resolveContentMediaUrl } from "../../assets/shared/content-media-url";

describe("published content media URLs", () => {
  const paths = new Set(["events/example/hero.png", "events/example/speaker photo.png"]);
  it("resolves exact known authored assets into the public media delivery tree", () => {
    expect(resolveContentMediaUrl("/events/example/hero.png?v=1#image", paths)).toBe(
      "/content-media/events/example/hero.png?v=1#image",
    );
    expect(resolveContentMediaUrl("/events/example/speaker%20photo.png", paths)).toBe(
      "/content-media/events/example/speaker%20photo.png",
    );
  });
  it("preserves canonical content assets and configured static or external URLs", () => {
    for (const url of [
      "/content-media/events/example/hero.png",
      "/img/banner.jpg",
      "https://images.example.test/banner.jpg",
      "//images.example.test/banner.jpg",
      "/events/example/missing.png",
      "/bad%encoding.png",
    ]) {
      expect(resolveContentMediaUrl(url, paths)).toBe(url);
    }
  });
});
