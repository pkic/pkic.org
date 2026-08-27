// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { ProposalManageResponse } from "../../assets/shared/schemas/proposal-management";
import type { ProposalSpeaker } from "../../assets/ts/admin/types";
import {
  buildReplacementProposerOptions,
  SpeakerCard,
} from "../../assets/ts/admin/sections/events/detail/proposal-detail/SpeakerCard";
import { adminProposalSpeakerAssetPath } from "../../assets/ts/admin/sections/events/detail/proposal-detail/ProposalSpeakerHeadshotManager";
import { ProposalManageSpeakerCard } from "../../assets/ts/event-flows/proposal-manage-page";

let container: HTMLElement | null = null;

afterEach(() => {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

function managedSpeaker(
  overrides: Partial<ProposalManageResponse["speakers"][number]> = {},
): ProposalManageResponse["speakers"][number] {
  return {
    userId: "speaker-1",
    role: "co_speaker",
    status: "confirmed",
    email: "speaker@example.test",
    firstName: "Casey",
    lastName: "Speaker",
    organizationName: null,
    jobTitle: null,
    links: [],
    headshotUpdatedAt: null,
    headshotUrl: null,
    confirmedAt: "2026-08-01T00:00:00.000Z",
    declinedAt: null,
    bio: null,
    headshotUploaded: false,
    ...overrides,
  };
}

function adminSpeaker(overrides: Partial<ProposalSpeaker> = {}): ProposalSpeaker {
  return {
    userId: "speaker-1",
    role: "co_speaker",
    status: "confirmed",
    email: "speaker@example.test",
    firstName: "Casey",
    lastName: "Speaker",
    organizationName: null,
    jobTitle: null,
    links: [],
    headshotUpdatedAt: null,
    headshotUrl: null,
    confirmedAt: "2026-08-01T00:00:00.000Z",
    declinedAt: null,
    declineReason: null,
    termsAcceptedAt: null,
    inviteExpiresAt: null,
    addedAt: "2026-08-01T00:00:00.000Z",
    biography: null,
    profileComplete: false,
    hasHeadshot: false,
    hasBio: false,
    ...overrides,
  };
}

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

describe("proposal speaker removal UI", () => {
  it("keeps admin headshot operations scoped to the proposal speaker", () => {
    expect(adminProposalSpeakerAssetPath("proposal/1", "user/1", "headshot")).toBe(
      "/api/v1/admin/proposals/proposal%2F1/speakers/user%2F1/headshot",
    );
    expect(adminProposalSpeakerAssetPath("proposal-1", "user-1", "gravatar")).toBe(
      "/api/v1/admin/proposals/proposal-1/speakers/user-1/gravatar",
    );
  });

  it("shows proposal reviewers the headshot without mutation controls", () => {
    const root = mount(
      <SpeakerCard
        speaker={adminSpeaker({ headshotUrl: "/api/v1/admin/proposals/proposal-1/speakers/speaker-1/headshot" })}
        proposalId="proposal-1"
        canEdit={false}
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    expect(root.querySelector<HTMLImageElement>('img[alt="Casey Speaker"]')?.src).toContain(
      "/api/v1/admin/proposals/proposal-1/speakers/speaker-1/headshot",
    );
    expect(root.textContent).not.toContain("Upload headshot");
    expect(root.textContent).not.toContain("Fetch from Gravatar");
    expect(root.textContent).not.toContain("Remove headshot");
  });

  it("lets a proposer remove only non-proposer speakers", () => {
    const nonProposer = mount(
      <ProposalManageSpeakerCard
        speaker={managedSpeaker()}
        token="manage-token"
        apiBase="/api/v1"
        isCurrentProposer={false}
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );
    expect(nonProposer.querySelector("[data-remove-proposal-speaker]")).not.toBeNull();
    expect(
      [...nonProposer.querySelectorAll("select option")].map((option) => option.getAttribute("value")),
    ).not.toContain("proposer");

    void act(() => render(null, nonProposer));
    const currentProposer = mount(
      <ProposalManageSpeakerCard
        speaker={managedSpeaker({ userId: "proposer-1", role: "proposer" })}
        token="manage-token"
        apiBase="/api/v1"
        isCurrentProposer
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );
    expect(currentProposer.querySelector("[data-remove-proposal-speaker]")).toBeNull();
    expect(
      [...currentProposer.querySelectorAll("select option")].map((option) => option.getAttribute("value")),
    ).toContain("proposer");

    void act(() => render(null, currentProposer));
    const presentingProposer = mount(
      <ProposalManageSpeakerCard
        speaker={managedSpeaker({ userId: "proposer-1", role: "moderator" })}
        token="manage-token"
        apiBase="/api/v1"
        isCurrentProposer
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );
    expect(presentingProposer.querySelector<HTMLSelectElement>("select")?.value).toBe("moderator");
    expect(
      [...presentingProposer.querySelectorAll("select option")].map((option) => option.getAttribute("value")),
    ).toEqual(expect.arrayContaining(["moderator", "speaker"]));
  });

  it("offers admin proposer transfer only to invited or confirmed speakers", () => {
    const speakers = [
      adminSpeaker({ userId: "proposer-1", role: "proposer" }),
      adminSpeaker({ userId: "invited-1", status: "invited", firstName: "Invited" }),
      adminSpeaker({ userId: "confirmed-1", status: "confirmed", firstName: "Confirmed" }),
      adminSpeaker({ userId: "declined-1", status: "declined", firstName: "Declined" }),
      adminSpeaker({ userId: "pending-1", status: "pending", firstName: "Pending" }),
    ];

    expect(buildReplacementProposerOptions(speakers, "proposer-1").map((option) => option.userId)).toEqual([
      "invited-1",
      "confirmed-1",
    ]);

    const root = mount(
      <SpeakerCard
        speaker={speakers[0]}
        proposalId="proposal-1"
        canEdit
        canFinalize
        isCurrentProposer
        replacementSpeakers={buildReplacementProposerOptions(speakers, "proposer-1")}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );
    expect(root.querySelector("[data-replacement-proposer]")).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>("[data-remove-proposal-speaker]")?.disabled).toBe(true);
  });

  it("surfaces final-speaker guidance instead of an admin removal action", () => {
    const root = mount(
      <SpeakerCard
        speaker={adminSpeaker({ userId: "proposer-1", role: "proposer" })}
        proposalId="proposal-1"
        canEdit
        canFinalize
        isCurrentProposer
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    expect(root.querySelector("[data-remove-proposal-speaker]")).toBeNull();
    expect(root.textContent).toContain("every proposal must retain its speaker roster");
  });
});
