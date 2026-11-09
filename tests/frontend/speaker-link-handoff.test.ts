import { participantSpeakerFixture } from "./helpers/participant-speaker-fixture";
import { parseQueryContext } from "../../assets/ts/shared/query-context";
import { beforeEach, expect, it, vi } from "vitest";
import { handoffSpeakerLink } from "../../assets/ts/event-flows/speaker-link-handoff";
import { loadSpeakerPageData } from "../../assets/ts/event-flows/speaker-link-recovery";

vi.mock("../../assets/ts/event-flows/speaker-link-recovery", () => ({ loadSpeakerPageData: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it.each([
  ["[data-event-speaker-manage]", "participation"],
  ["[data-event-speaker-presentation]", "presentations"],
] as const)("hands %s to the account-owned %s facet", async (selector, facet) => {
  const data = participantSpeakerFixture();
  vi.mocked(loadSpeakerPageData).mockResolvedValue({
    boot: {
      eventSlug: "conference",
      apiBase: "/api/v1",
      eventPagePath: null,
      root: document.createElement("div"),
      form: document.createElement("form"),
      statusEl: document.createElement("div"),
      query: parseQueryContext(""),
    },
    token: "test-speaker-token",
    loadingEl: null,
    contentEl: null,
    data,
  });
  const navigate = vi.fn();
  await handoffSpeakerLink(selector, facet, navigate);
  expect(navigate).toHaveBeenCalledWith(
    `/portal/#/events/conference/proposals/${data.proposal.id}/${facet}?speaker=${data.speaker.userId}`,
  );
});

it("leaves invalid and expired links on the recovery screen", async () => {
  vi.mocked(loadSpeakerPageData).mockResolvedValue(null);
  const navigate = vi.fn();
  await handoffSpeakerLink("[data-event-speaker-presentation]", "presentations", navigate);
  expect(navigate).not.toHaveBeenCalled();
});
