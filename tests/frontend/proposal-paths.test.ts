import { describe, expect, it } from "vitest";
import {
  eventProposalDetailViewPath,
  eventProposalsViewPath,
} from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-paths";

describe("event proposal view paths", () => {
  it("builds the proposals tab path and its reserved detail path", () => {
    expect(eventProposalsViewPath("PQC Europe/2026")).toBe("/events/PQC%20Europe%2F2026/proposals");
    // The detail view lives under a reserved `detail` segment so it cannot
    // collide with a Proposals sub-tab key (e.g. `responses`, `email`).
    expect(eventProposalDetailViewPath("event", "proposal/1")).toBe("/events/event/proposals/detail/proposal%2F1");
  });
});
