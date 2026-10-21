// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeakerProfileReviews } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SpeakerProfileReviews";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { speakerProfileApprovalSchema } from "../../assets/shared/schemas/event-speaker-profile-reviews";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { runRowAction, rowActionControlNames } from "./helpers/row-actions";
const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", async (original) => ({
  ...(await original<typeof import("../../assets/ts/shared/api-client")>()),
  ...api,
}));
const profile = {
  userId: crypto.randomUUID(),
  identityId: crypto.randomUUID(),
  displayName: "Alex Example",
  organizationId: crypto.randomUUID(),
  organizationName: "Example organization",
  jobTitle: "Researcher",
  biography: "The current canonical biography.",
  links: ["https://example.org/alex"],
  photoUrl: null,
  sessionCount: 3,
  profileDigest: "a".repeat(64),
  reviewedAt: null,
  available: true,
};
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "event",
  timeZone: "UTC",
  revision: 4,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  vi.resetAllMocks();
  history.replaceState(null, "", "/");
});
async function show(canReview = true) {
  api.getJson.mockResolvedValue({
    profiles: [profile],
    canReview,
    page: { limit: 50, offset: 0, total: 1, hasMore: false },
  });
  const saved = vi.fn();
  await act(async () => render(<SpeakerProfileReviews snapshot={snapshot} onSaved={saved} />, host));
  await vi.waitFor(() => expect(host.textContent).toContain(profile.displayName));
  return saved;
}
describe("speaker profile review", () => {
  it("shows the full canonical profile and submits one identity review for all sessions", async () => {
    const saved = await show();
    api.postJson.mockResolvedValue({ agenda: { ...snapshot, revision: 5 } });
    await runRowAction(host, profile.displayName, "Review profile");
    expect(host.querySelector("dialog")?.textContent).toContain(profile.biography);
    expect(host.querySelector("dialog")?.textContent).toContain(profile.organizationName);
    expect(host.querySelector(`dialog a[href='${profile.links[0]}']`)).not.toBeNull();
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("dialog button")]
        .find((b) => b.textContent === "Approve profile")!
        .click(),
    );
    expect(api.postJson).toHaveBeenCalledOnce();
    const [url, body] = api.postJson.mock.calls[0];
    expect(url).toBe("/api/v1/events/event/speakers/profiles/reviews");
    const parsed = speakerProfileApprovalSchema.parse(body);
    expect(parsed.expectedRevision).toBe(snapshot.revision);
    expect(parsed.userId).toBe(profile.userId);
    expect(parsed.identityId).toBe(profile.identityId);
    expect(parsed.profileDigest).toBe(profile.profileDigest);
    expect(saved).toHaveBeenCalledOnce();
    expect(host.querySelector("dialog")).toBeNull();
  });
  it("keeps a refused review open and does not report it as saved", async () => {
    const saved = await show();
    api.postJson.mockRejectedValue(
      new ApiClientError(
        { error: { code: "SPEAKER_PROFILE_CHANGED", message: "The profile changed. Refresh and review it again." } },
        409,
      ),
    );
    await runRowAction(host, profile.displayName, "Review profile");
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("dialog button")]
        .find((b) => b.textContent === "Approve profile")!
        .click(),
    );
    expect(host.querySelector("dialog")).not.toBeNull();
    expect(host.textContent).toContain("The profile changed");
    expect(saved).not.toHaveBeenCalled();
  });
  it("offers no approval action without staff review permission", async () => {
    await show(false);
    expect(rowActionControlNames(host)).toEqual([]);
    expect(api.postJson).not.toHaveBeenCalled();
  });
});
