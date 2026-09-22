import { describe, expect, it } from "vitest";
import { classifyLogoInk } from "../../assets/ts/shared/member-logo-treatment";

const image = (...pixels: number[][]) => new Uint8ClampedArray(pixels.flat());
const clear = [0, 0, 0, 0];
const white = [255, 255, 255, 255];
const black = [0, 0, 0, 255];

describe("monochrome member artwork", () => {
  it("does not invert white lettering on transparency", () => {
    expect(classifyLogoInk(image(white, clear, white, clear), 2)).toBe("light");
  });
  it("inverts dark lettering even when it touches every corner", () => {
    expect(classifyLogoInk(image(black, clear, black, clear, black, clear, black, clear, black), 3)).toBe("dark");
  });
  it("uses the background for opaque assets rather than flattening their lettering", () => {
    expect(classifyLogoInk(image(white, white, white, white, black, white, white, white, white), 3)).toBe("dark");
    expect(classifyLogoInk(image(black, black, black, black, white, black, black, black, black), 3)).toBe("light");
  });
  it("weights antialiased pixels by coverage and retains mixed artwork contrast", () => {
    expect(classifyLogoInk(image([255, 255, 255, 1], black, clear, [30, 80, 160, 255]), 2)).toBe("dark");
  });
});
