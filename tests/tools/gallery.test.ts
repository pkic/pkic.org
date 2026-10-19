import { describe, expect, it } from "vitest";
import { parseShotArguments } from "../../scripts/gallery/shot-options.mjs";

describe("pnpm gallery:shot", () => {
  it("names the screenshot after the entry and its variant", () => {
    expect(parseShotArguments(["menu"])).toMatchObject({ id: "menu", file: "menu.png", colorScheme: "light" });
    expect(parseShotArguments(["--phone", "menu", "--dark"])).toMatchObject({
      file: "menu-phone-dark.png",
      viewport: { width: 375, height: 700 },
      colorScheme: "dark",
    });
    expect(() => parseShotArguments([])).toThrow("Usage");
    expect(() => parseShotArguments(["../x"])).toThrow("Usage");
  });
});
