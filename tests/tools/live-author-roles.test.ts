import { describe, expect, it } from "vitest";
import {
  LIVE_AUTHOR_ROLE_IDS,
  inlineLiveAuthorRoles,
  liveAuthorRoleForCredit,
  liveAuthorRoleForDuty,
  liveAuthorRoleLabel,
  orderLiveAuthorRoles,
} from "../../assets/shared/live-author-roles";

describe("live author roles", () => {
  it("ranks the event team first and membership last, each role once", () => {
    expect(LIVE_AUTHOR_ROLE_IDS).toEqual([
      "event_team",
      "speaker",
      "moderator",
      "host",
      "chair",
      "vice_chair",
      "member",
    ]);
    expect(orderLiveAuthorRoles(["member", "chair", "speaker", "member", "event_team"])).toEqual([
      "event_team",
      "speaker",
      "chair",
      "member",
    ]);
  });

  it("shows the two highest roles inline", () => {
    expect(inlineLiveAuthorRoles(["member", "vice_chair", "moderator"])).toEqual(["moderator", "vice_chair"]);
    expect(inlineLiveAuthorRoles([])).toEqual([]);
  });

  it("marks only exceptional roles inline: membership stays on the author's card", () => {
    expect(inlineLiveAuthorRoles(["member"])).toEqual([]);
    expect(inlineLiveAuthorRoles(["member", "event_team"])).toEqual(["event_team"]);
  });

  it("reads agenda credits and shown duties as room roles", () => {
    expect(liveAuthorRoleForCredit("co_speaker")).toBe("speaker");
    expect(liveAuthorRoleForCredit("panelist")).toBe("speaker");
    expect(liveAuthorRoleForCredit("moderator")).toBe("moderator");
    expect(liveAuthorRoleForCredit("proposer")).toBeNull();
    expect(liveAuthorRoleForDuty(" Host ")).toBe("host");
    expect(liveAuthorRoleForDuty("Registration desk")).toBe("event_team");
    expect(liveAuthorRoleLabel("member")).toBe("PKI Consortium member");
  });
});
