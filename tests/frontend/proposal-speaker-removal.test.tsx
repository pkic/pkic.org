// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { ProposalAccessResponse } from "../../assets/shared/schemas/proposal-management";
import type { ProposalSpeaker } from "../../assets/ts/member-flows/portal/sections/events/types";
import {
  buildReplacementProposerOptions,
  proposalSpeakerEndpoints,
  SpeakerCard,
} from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/SpeakerCard";
import { proposalSpeakerAssetPath } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/ProposalSpeakerHeadshotManager";
import { ProposalSpeakerCard } from "../../assets/ts/components/proposals/ProposalSpeakerCard";
import { proposalSpeakerPatchSchema } from "../../assets/shared/schemas/proposal-management";
import { ProposalManageSpeakerCard, SpeakerList } from "../../assets/ts/event-flows/proposal-manage-page";
import { buttonNamed, controlFor, labelNames, submitForm, typeInto } from "./helpers/labelled-control";

let container: HTMLElement | null = null;

afterEach(() => {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function managedSpeaker(
  overrides: Partial<ProposalAccessResponse["speakers"][number]> = {},
): ProposalAccessResponse["speakers"][number] {
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

function proposalSpeaker(overrides: Partial<ProposalSpeaker> = {}): ProposalSpeaker {
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
    expect(proposalSpeakerAssetPath("proposal/1", "user/1", "headshot")).toBe(
      "/api/v1/proposals/proposal%2F1/speakers/user%2F1/headshot",
    );
    expect(proposalSpeakerAssetPath("proposal-1", "user-1", "gravatar")).toBe(
      "/api/v1/proposals/proposal-1/speakers/user-1/headshot",
    );
  });

  it("shows proposal reviewers the headshot without mutation controls", () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker({ headshotUrl: "/api/v1/proposals/proposal-1/speakers/speaker-1/headshot" })}
        proposalId="proposal-1"
        canEdit={false}
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    expect(root.querySelector<HTMLImageElement>('img[alt="Casey Speaker"]')?.src).toContain(
      "/api/v1/proposals/proposal-1/speakers/speaker-1/headshot",
    );
    expect(root.textContent).not.toContain("Upload headshot");
    expect(root.textContent).not.toContain("Fetch from Gravatar");
    expect(root.textContent).not.toContain("Remove headshot");
  });

  it("uses canonical speaker reminder and headshot resources with natural JSON bodies", async () => {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        requests.push({ url, method: init?.method ?? "GET", body: init?.body?.toString() ?? null });
        return Response.json({ success: true, headshotUrl: "https://example.test/headshot.jpg" });
      }),
    );

    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker()}
        proposalId="proposal-1"
        canEdit
        canFinalize
        decisionStatus="accepted"
        requiresPresentation
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    await act(() =>
      (root.querySelector('button[title="Send profile completion reminder"]') as HTMLButtonElement).click(),
    );
    await settle();
    expect(requests[0]).toMatchObject({
      url: "/api/v1/proposals/proposal-1/speakers/speaker-1/reminders",
      method: "POST",
      body: JSON.stringify({ kind: "profile" }),
    });

    // Located by the name the reader hears, not by the layout class the button
    // used to carry: the class is gone and a name cannot silently disappear
    // without the control becoming unusable anyway.
    const fetchGravatar = [...root.querySelectorAll("button")].find(
      (button) => button.textContent === "🌐 Fetch from Gravatar",
    );
    expect(fetchGravatar).toBeDefined();
    await act(() => fetchGravatar!.click());
    await settle();
    expect(requests[1]).toMatchObject({
      url: "/api/v1/proposals/proposal-1/speakers/speaker-1/headshot",
      method: "POST",
      body: JSON.stringify({ source: "gravatar" }),
    });
    expect(requests.every(({ url }) => !url.includes("/api/v1/admin/"))).toBe(true);
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
      proposalSpeaker({ userId: "proposer-1", role: "proposer" }),
      proposalSpeaker({ userId: "invited-1", status: "invited", firstName: "Invited" }),
      proposalSpeaker({ userId: "confirmed-1", status: "confirmed", firstName: "Confirmed" }),
      proposalSpeaker({ userId: "declined-1", status: "declined", firstName: "Declined" }),
      proposalSpeaker({ userId: "pending-1", status: "pending", firstName: "Pending" }),
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
        speaker={proposalSpeaker({ userId: "proposer-1", role: "proposer" })}
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

  /**
   * The edit form used to be bare `<label>`s beside bare inputs with nothing
   * tying either pair together, so every control in it announced itself
   * unnamed. Assert the association rather than the appearance: that is the
   * half a visual review cannot see.
   */
  it("gives every editable speaker field a name a screen reader can reach", () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker()}
        proposalId="proposal-1"
        canEdit
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    void act(() => buttonNamed(root, "Edit profile").click());

    const form = root.querySelector("form")!;
    expect(labelNames(form)).toEqual(["First name", "Last name", "Organization", "Job title", "Role", "Biography"]);
    // Resolving through the `for`/`id` pair fails exactly when the pair is
    // broken, so this asserts the contract rather than the markup.
    expect(controlFor(form, "Role").tagName.toLowerCase()).toBe("select");
    expect(controlFor(form, "Biography").tagName.toLowerCase()).toBe("textarea");

    // ProfileLinksInput names its own controls, so the surrounding group is
    // named by the heading beside it rather than by an orphaned `for`.
    const group = form.querySelector<HTMLElement>('[role="group"]');
    const groupName = group?.getAttribute("aria-labelledby");
    expect(groupName).toBeTruthy();
    expect(root.ownerDocument.getElementById(groupName!)?.textContent?.trim()).toBe("Profile links");
  });

  it("reports a refused profile save and keeps the reader in the form", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return Response.json({ error: { code: "CONFLICT", message: "Another editor saved first" } }, { status: 409 });
      }),
    );
    const notify = vi.fn();

    const root = mount(
      <ProposalSpeakerCard
        speaker={proposalSpeaker()}
        proposalId="proposal-1"
        canEdit
        isCurrentProposer={false}
        replacementSpeakers={[]}
        endpoints={proposalSpeakerEndpoints()}
        onSaved={() => {}}
        onRemoved={() => {}}
        notify={notify}
      />,
    );

    void act(() => buttonNamed(root, "Edit profile").click());
    await typeInto(controlFor(root, "Biography"), "A biography the server will refuse.");
    await submitForm(root);

    // The request is checked against the canonical contract rather than a
    // literal, so a schema change cannot leave this passing on a shape the
    // endpoint no longer accepts.
    expect(bodies).toHaveLength(1);
    expect(proposalSpeakerPatchSchema.parse(JSON.parse(bodies[0]))).toMatchObject({
      biography: "A biography the server will refuse.",
      role: "co_speaker",
    });
    expect(notify).toHaveBeenCalledWith("Another editor saved first", "error");
    // The form stays open, so the refused edit is still there to correct.
    expect((controlFor(root, "Biography") as HTMLTextAreaElement).value).toBe("A biography the server will refuse.");
  });

  it("names the managed speaker's card and ties its biography guidance to the control", () => {
    const root = mount(
      <ProposalManageSpeakerCard
        speaker={managedSpeaker()}
        token="manage-token"
        apiBase="/api/v1"
        isCurrentProposer={false}
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );

    // A proposal can carry several of these; an unnamed <section> is not
    // exposed as a region at all, so each card says whose it is.
    const card = root.querySelector("section");
    expect(card?.getAttribute("aria-label")).toBe("Speaker Casey Speaker");
    expect(labelNames(root)).toEqual(["First name", "Last name", "Role", "Organization", "Job title", "Biography"]);

    const biography = controlFor<HTMLTextAreaElement>(root, "Biography");
    const help = root.querySelector(`#${biography.getAttribute("aria-describedby")!}`);
    expect(help?.textContent).toBe("Visible to attendees on the event program.");
  });

  it("keeps the removal control focusable while the request is in flight", async () => {
    let resolveRemoval: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Promise<Response>((resolve) => {
            resolveRemoval = () => resolve(Response.json({ success: true }));
          }),
      ),
    );
    vi.stubGlobal("confirm", () => true);

    const root = mount(
      <ProposalManageSpeakerCard
        speaker={managedSpeaker()}
        token="manage-token"
        apiBase="/api/v1"
        isCurrentProposer={false}
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );

    const remove = root.querySelector<HTMLButtonElement>("[data-remove-proposal-speaker]")!;
    void act(() => remove.click());

    // A `disabled` control loses focus, which throws a screen-reader user out
    // of the card mid-request; the busy state is announced instead.
    expect(remove.disabled).toBe(false);
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.getAttribute("aria-busy")).toBe("true");
    expect(remove.textContent).toBe("Removing…");

    resolveRemoval?.();
    await settle();
  });

  it("says the roster is empty in words rather than rendering nothing", () => {
    const root = mount(
      <SpeakerList
        speakers={[]}
        token="manage-token"
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );

    const status = root.querySelector('[role="status"]');
    expect(status?.textContent).toContain("No speakers added yet");
  });
});
