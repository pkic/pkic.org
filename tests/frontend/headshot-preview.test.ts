// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHeadshotPreview } from "../../assets/ts/shared/headshot/preview";

describe("renderHeadshotPreview", () => {
  it("applies the shared avatar container class when rendering an image", () => {
    const host = document.createElement("div");

    renderHeadshotPreview(host, "/images/headshot.jpg", { alt: "Speaker headshot" });

    expect(host.classList.contains("pkic-headshot-preview")).toBe(true);
    const image = host.querySelector<HTMLImageElement>("img.pkic-headshot-preview__image");
    expect(image?.getAttribute("src")).toBe("/images/headshot.jpg");
    expect(image?.getAttribute("alt")).toBe("Speaker headshot");
  });

  it("renders the placeholder inside the shared avatar container", () => {
    const host = document.createElement("div");

    renderHeadshotPreview(host, null, { emptyLabel: "No photo" });

    expect(host.classList.contains("pkic-headshot-preview")).toBe(true);
    expect(host.querySelector(".pkic-headshot-preview__placeholder")?.textContent).toContain("No photo");
  });
});
