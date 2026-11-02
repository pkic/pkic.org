import { beforeEach, expect, it, vi } from "vitest";
import { handoffSpeakerLink } from "../../assets/ts/event-flows/speaker-link-handoff";
import { loadSpeakerPageData } from "../../assets/ts/event-flows/speaker-link-recovery";

vi.mock("../../assets/ts/event-flows/speaker-link-recovery", () => ({ loadSpeakerPageData: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it("hands an existing speaker link to the account-owned participation in the event app", async () => {
  vi.mocked(loadSpeakerPageData).mockResolvedValue({
    boot: { eventSlug: "conference", apiBase: "/api/v1" },
    data: { proposal: { id: "proposal-123" }, speaker: { userId: "speaker-123" } },
  } as never);
  const navigate = vi.fn();
  await handoffSpeakerLink("[data-event-speaker-manage]", navigate);
  expect(navigate).toHaveBeenCalledWith(
    "/portal/#/events/conference/proposals/proposal-123/participation?speaker=speaker-123",
  );
});

it("leaves invalid and expired links on the recovery screen", async () => {
  vi.mocked(loadSpeakerPageData).mockResolvedValue(null);
  const navigate = vi.fn();
  await handoffSpeakerLink("[data-event-speaker-presentation]", navigate);
  expect(navigate).not.toHaveBeenCalled();
});
