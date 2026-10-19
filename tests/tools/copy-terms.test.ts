import { describe, expect, it } from "vitest";
import { copyTermFindings } from "../../scripts/check-copy-terms.mjs";

describe("copy terms gate", () => {
  it("flags British spellings and vendor names", () => {
    expect(copyTermFindings("Pick a colour for the centre panel")).toEqual([{ rule: "US English", term: "colour" }]);
    expect(copyTermFindings("Open the OBS scene")).toEqual([{ rule: "vendor-neutral production", term: "OBS" }]);
    expect(copyTermFindings("Load it in vMix")).toHaveLength(1);
  });

  it("allows the platform's labelledby and ordinary words", () => {
    expect(copyTermFindings('<div aria-labelledby="title" labelledBy={id}>')).toEqual([]);
    expect(copyTermFindings("observe the jobs; color, center, program, catalog, labeled")).toEqual([]);
    expect(copyTermFindings("recentResult, liveProgramMessageSchema, a programmer, an organism, analysis")).toEqual([]);
  });

  it("flags British spellings inside identifiers", () => {
    expect(copyTermFindings("const PAGE_COLOURS = pageColours;")).toEqual([{ rule: "US English", term: "COLOUR" }]);
    expect(copyTermFindings("catalogueQuery")).toEqual([{ rule: "US English", term: "catalogue" }]);
    expect(copyTermFindings("the Programme committee")).toHaveLength(1);
  });
});
