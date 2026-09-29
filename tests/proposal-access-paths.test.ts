import { describe, expect, it } from "vitest";
import { proposalAccessPath, proposalSpeakerAccessPath } from "../assets/shared/proposal-access-paths";

describe("proposal capability resource paths", () => {
  it("normalizes the API base and encodes every resource segment", () => {
    expect(proposalAccessPath("/api/v1/", "proposal/token", "speakers", "user id", "headshot")).toBe(
      "/api/v1/proposals/access/proposal%2Ftoken/speakers/user%20id/headshot",
    );
  });

  it("builds speaker access resources from the same canonical boundary", () => {
    expect(proposalSpeakerAccessPath("https://app.test/api/v1", "speaker/token", "reminder-preferences")).toBe(
      "https://app.test/api/v1/proposals/speakers/access/speaker%2Ftoken/reminder-preferences",
    );
  });
});
