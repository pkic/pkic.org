import { describe, expect, it } from "vitest";
import { groupContextNavigation } from "../../assets/ts/member-flows/portal/sections/management/group-context-navigation";

describe("selected-group capability navigation", () => {
  it("exposes collaboration without management controls to participants", () => {
    expect(groupContextNavigation(["view", "participate"]).map((item) => item.key)).toEqual([
      "overview",
      "events",
      "meetings",
      "forms",
      "mailing-lists",
    ]);
  });

  it("exposes management views without manufacturing participation", () => {
    expect(groupContextNavigation(["view", "manage"]).map((item) => item.key)).toEqual([
      "overview",
      "events",
      "meetings",
      "forms",
      "audit",
      "settings",
      "members",
      "leadership",
    ]);
  });

  it("keeps a read-only group context read-only", () => {
    expect(groupContextNavigation(["view"]).map((item) => item.key)).toEqual(["overview"]);
  });
});
