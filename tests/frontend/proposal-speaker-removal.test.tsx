// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { ProposalSpeaker } from "../../assets/ts/member-flows/portal/sections/events/types";
import {
  buildReplacementProposerOptions,
  proposalSpeakerEndpoints,
  SpeakerCard,
} from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/SpeakerCard";
import { ProposalSpeakerCard } from "../../assets/ts/components/proposals/ProposalSpeakerCard";
import * as confirmation from "../../assets/ts/components/ConfirmDialog";
import { proposalSpeakerAcceptanceRequestSchema } from "../../assets/shared/schemas/proposal-speakers";
import { proposalSpeakerPatchSchema } from "../../assets/shared/schemas/proposal-management";
import { identityUpdateSchema } from "../../assets/shared/schemas/identity-public-profile";
import { PROPOSAL_SPEAKER_ROLES } from "../../assets/shared/schemas/participant-roles";
import {
  controlFor,
  labelNames,
  markdownControl,
  markdownValue,
  optionValues,
  submitForm,
  typeMarkdown,
} from "./helpers/labeled-control";

// The consent asked before a photo import is the shared disclaimer's own test; here it is given.
vi.mock("../../assets/ts/shared/headshot/upload", async (original) => ({
  ...(await original<typeof import("../../assets/ts/shared/headshot/upload")>()),
  showHeadshotDisclaimer: () => Promise.resolve(true),
}));
import { openCardMenu, runCardAction } from "./helpers/row-actions";
import { SPEAKER_NOT_YET_ACCEPTED_LABEL } from "../../assets/shared/proposal-speaker-acceptance";

let container: HTMLElement | null = null;

afterEach(() => {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function proposalSpeaker(overrides: Partial<ProposalSpeaker> = {}): ProposalSpeaker {
  return {
    actingIdentityId: null,
    actingIdentitySelectedAt: null,
    actingIdentitySelection: "unrecorded",
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

const IDENTITY_ID = "60000000-0000-4000-8000-000000000001";
const EDIT_IDENTITY = { canEditIdentity: true, canEditHeadshot: true };

/** The identity resource the card's editor reads, answering every write with `write`. */
function stubIdentity(requests: Array<{ url: string; method: string; body: string | null }>, write?: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: init?.body?.toString() ?? null });
      if (method !== "GET" && write) return write.clone();
      return Response.json({
        identityId: IDENTITY_ID,
        userId: "40000000-0000-4000-8000-000000000001",
        personName: "Casey Speaker",
        organizationId: null,
        organizationName: null,
        endedAt: null,
        hiddenFromPublicProfile: false,
        jobTitle: null,
        biography: "The identity biography.",
        links: [],
      });
    }),
  );
}

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

describe("proposal speaker removal UI", () => {
  it("accepts an outstanding invitation through the organizer action and reloads the roster", async () => {
    vi.spyOn(confirmation, "confirmAction").mockResolvedValue(true);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal("fetch", fetcher);
    const onReload = vi.fn();
    const root = mount(
      <ProposalSpeakerCard
        speaker={proposalSpeaker({ status: "invited" })}
        proposalId="proposal-1"
        canFinalize
        endpoints={proposalSpeakerEndpoints()}
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
        onProfileChanged={onReload}
      />,
    );
    await runCardAction(root, "Casey Speaker", "Accept on behalf of speaker");
    await settle();
    expect(confirmation.confirmAction).toHaveBeenCalled();
    const [path, init] = fetcher.mock.calls[0];
    expect(path).toBe("/api/v1/proposals/proposal-1/speakers/speaker-1/acceptance");
    expect(init.method).toBe("POST");
    expect(proposalSpeakerAcceptanceRequestSchema.safeParse(JSON.parse(init.body)).success).toBe(true);
    expect(onReload).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "does not offer organizer acceptance for a confirmed speaker (manager: %s)",
    async (canFinalize) => {
      const root = mount(
        <ProposalSpeakerCard
          speaker={proposalSpeaker()}
          proposalId="proposal-1"
          canFinalize={canFinalize}
          endpoints={proposalSpeakerEndpoints()}
          isCurrentProposer={false}
          replacementSpeakers={[]}
          onSaved={() => {}}
          onRemoved={() => {}}
        />,
      );
      const items = await openCardMenu(root, "Casey Speaker");
      expect(items.map((item) => item.textContent?.trim())).not.toContain("Accept on behalf of speaker");
    },
  );

  it("shows proposal reviewers the headshot without mutation controls", async () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker({
          headshotUrl: "/api/v1/users/speaker-1/headshot",
          biography: "Protected full biography remains readable in the selected profile.",
        })}
        identityId={IDENTITY_ID}
        proposalId="proposal-1"
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    expect(root.querySelector<HTMLImageElement>(".pk-avatar img")?.src).toContain("/api/v1/users/speaker-1/headshot");
    expect(root.querySelector("article.pk-agenda-speaker-directory__card")).not.toBeNull();
    expect(root.textContent).not.toContain("speaker@example.test");
    // The read-only tile is the photo alone: it is not a control, and nothing
    // beside it changes or removes it.
    expect(root.querySelector('button[aria-label$="photo of Casey Speaker"]')).toBeNull();
    expect(root.querySelector('input[type="file"]')).toBeNull();
    const items = await openCardMenu(root, "Casey Speaker");
    const labels = items.map((item) => item.textContent?.trim());
    expect(labels).not.toContain("Edit identity");
    expect(labels).not.toContain("Import photo from Gravatar…");
    await act(() => items.find((item) => item.textContent?.trim() === "View profile details")!.click());
    expect(root.querySelector("dialog")?.textContent).toContain("Protected full biography remains readable");
    expect(root.querySelector("dialog")?.textContent).toContain("speaker@example.test");
  });

  it("leads to the speaker's user and identity from the card's menu", async () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker()}
        identityId={IDENTITY_ID}
        userHref="#/users/speaker-1"
        identityHref="#/users/speaker-1/profile"
        proposalId="proposal-1"
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );
    const items = await openCardMenu(root, "Casey Speaker");
    const identity = items.find((item) => item.textContent?.trim() === "Open identity");
    expect(identity?.getAttribute("href")).toBe("#/users/speaker-1/profile");
  });

  it("sends reminders to the speaker and imports a Gravatar onto the person's own headshot", async () => {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        requests.push({ url, method: init?.method ?? "GET", body: init?.body?.toString() ?? null });
        return Response.json({ success: true, source: "gravatar" });
      }),
    );
    const onProfileChanged = vi.fn();

    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker()}
        proposalId="proposal-1"
        profileAccess={{ canEditIdentity: false, canEditHeadshot: true }}
        canFinalize
        decisionStatus="accepted"
        requiresPresentation
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onProfileChanged={onProfileChanged}
        onRemoved={() => {}}
      />,
    );

    // The commands sit behind the card's own menu, named for the speaker.
    await runCardAction(root, "Casey Speaker", "Send profile reminder");
    await settle();
    expect(requests[0]).toMatchObject({
      url: "/api/v1/proposals/proposal-1/speakers/speaker-1/reminders",
      method: "POST",
      body: JSON.stringify({ kind: "profile" }),
    });

    // A headshot is the person's, not the proposal's: the import writes theirs.
    await runCardAction(root, "Casey Speaker", "Import photo from Gravatar…");
    await settle();
    expect(requests[1]).toMatchObject({ url: "/api/v1/users/speaker-1/gravatar", method: "POST" });
    expect(onProfileChanged).toHaveBeenCalledTimes(1);
    expect(requests.every(({ url }) => !url.includes("/api/v1/admin/"))).toBe(true);
  });

  it("tells organizers which speaker has not accepted yet", () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker({ userId: "invited-1", status: "invited", firstName: "Invited" })}
        proposalId="proposal-1"
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );
    expect(root.textContent).toContain(SPEAKER_NOT_YET_ACCEPTED_LABEL);
  });

  it("offers admin proposer transfer only to invited or confirmed speakers", async () => {
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
        canFinalize
        isCurrentProposer
        replacementSpeakers={buildReplacementProposerOptions(speakers, "proposer-1")}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );
    // Removing the proposer asks for the replacement in a dialog of its own,
    // and the confirmation stays closed until one is chosen.
    await runCardAction(root, "Casey Speaker", "Remove speaker");
    const dialog = root.querySelector<HTMLDialogElement>("dialog");
    expect(dialog?.querySelector("[data-replacement-proposer]")).not.toBeNull();
    const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Remove speaker",
    );
    expect(confirm?.disabled).toBe(true);
  });

  it("explains final-proposer removal only when the action is attempted", async () => {
    const notify = vi.fn();
    const root = mount(
      <ProposalSpeakerCard
        endpoints={proposalSpeakerEndpoints()}
        notify={notify}
        speaker={proposalSpeaker({ userId: "proposer-1", role: "proposer" })}
        proposalId="proposal-1"
        canFinalize
        isCurrentProposer
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    const items = await openCardMenu(root, "Casey Speaker");
    expect(items.map((item) => item.textContent?.trim())).toContain("Remove speaker");
    expect(root.textContent).not.toContain("first invite another speaker");
    await act(() => items.find((item) => item.textContent?.trim() === "Remove speaker")!.click());
    expect(notify).toHaveBeenCalledWith("Invite another speaker to take over before removing the proposer.", "error");
    expect(root.querySelector("dialog")).toBeNull();
    // The answer is said once, in words with its date, not as a pill.
    expect(root.textContent?.match(/Accepted/g)).toHaveLength(1);
    expect(root.querySelector(".pk-speaker-portrait-standing")?.textContent).toMatch(/Accepted \w/);
    expect(root.querySelector(".pk-badge")).toBeNull();
    // The role is read once.
    expect(root.textContent?.match(/Proposer/g)).toHaveLength(1);
  });

  /**
   * Editing a speaker edits the identity they speak as, through the same
   * fields the identity's owner uses — never a second set of fields kept on
   * the proposal. Assert the association rather than the appearance: that is
   * the half a visual review cannot see.
   */
  it("edits the identity itself with the shared identity fields, each named for a screen reader", async () => {
    stubIdentity([]);
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker()}
        identityId={IDENTITY_ID}
        profileAccess={EDIT_IDENTITY}
        proposalId="proposal-1"
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    await runCardAction(root, "Casey Speaker", "Edit identity");
    await settle();

    const form = root.querySelector("form")!;
    expect(form.noValidate).toBe(true);
    expect(labelNames(form)).toEqual(["About you"]);
    // The links are a group of one-URL inputs, named as a group rather than by a single label.
    expect(form.querySelector('input[aria-label="Profile link URL"]')).not.toBeNull();
    expect(form.textContent).toContain("Social and profile links");
    expect((await markdownControl(form, "About you")).getAttribute("role")).toBe("textbox");
    expect(await markdownValue(root, "About you")).toBe("The identity biography.");
    expect(form.textContent).toContain("This changes the identity itself.");
    // The headshot is the person's own, changed with the shared picture tile.
    expect(root.querySelector('button[aria-label$="photo of Casey Speaker"]')).not.toBeNull();
  });

  it("offers editing only to a viewer who may change the identity", async () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker()}
        identityId={IDENTITY_ID}
        profileAccess={{ canEditIdentity: false, canEditHeadshot: false }}
        canFinalize
        proposalId="proposal-1"
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );
    const labels = (await openCardMenu(root, "Casey Speaker")).map((item) => item.textContent?.trim());
    expect(labels).not.toContain("Edit identity");
    expect(labels).not.toContain("Change headshot");
    expect(root.textContent).not.toContain("Add headshot");
  });

  it("offers a co-speaker every role in the contract except the proposer's", async () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker()}
        canFinalize
        proposalId="proposal-1"
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    await runCardAction(root, "Casey Speaker", "Change role…");

    // Derived from the vocabulary rather than listed here: a role added to the
    // contract becomes available to every speaker but the proposer, whose role
    // moves by promoting someone else.
    const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
    expect(optionValues(controlFor<HTMLSelectElement>(dialog, "Role"))).toEqual(
      PROPOSAL_SPEAKER_ROLES.filter((role) => role !== "proposer"),
    );
  });

  it("holds the proposer's own card to the proposer role", async () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker({ role: "proposer" })}
        canFinalize
        proposalId="proposal-1"
        isCurrentProposer
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    const labels = (await openCardMenu(root, "Casey Speaker")).map((item) => item.textContent?.trim());
    expect(labels).not.toContain("Change role…");
  });

  it("changes the role through the proposal's own contract", async () => {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        requests.push({ url, method: init?.method ?? "GET", body: init?.body?.toString() ?? null });
        return Response.json({
          success: true,
          speaker: { ...proposalSpeaker(), userId: "40000000-0000-4000-8000-000000000001", role: "moderator" },
        });
      }),
    );
    const onSaved = vi.fn();
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker()}
        canFinalize
        proposalId="proposal-1"
        isCurrentProposer={false}
        replacementSpeakers={[]}
        onSaved={onSaved}
        onRemoved={() => {}}
      />,
    );

    await runCardAction(root, "Casey Speaker", "Change role…");
    const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
    const select = controlFor<HTMLSelectElement>(dialog, "Role");
    await act(async () => {
      select.value = "moderator";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save role")!;
    await act(() => save.click());
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: "/api/v1/proposals/proposal-1/speakers/speaker-1", method: "PATCH" });
    expect(proposalSpeakerPatchSchema.parse(JSON.parse(requests[0].body!))).toEqual({ role: "moderator" });
    expect(onSaved).toHaveBeenCalledWith("speaker-1", { role: "moderator" });
  });

  it("reports a refused identity save and keeps the reader in the form", async () => {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    stubIdentity(
      requests,
      Response.json({ error: { code: "CONFLICT", message: "Another editor saved first" } }, { status: 409 }),
    );

    const root = mount(
      <ProposalSpeakerCard
        speaker={proposalSpeaker()}
        identityId={IDENTITY_ID}
        profileAccess={EDIT_IDENTITY}
        proposalId="proposal-1"
        isCurrentProposer={false}
        replacementSpeakers={[]}
        endpoints={proposalSpeakerEndpoints()}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    await runCardAction(root, "Casey Speaker", "Edit identity");
    await settle();
    await typeMarkdown(root, "About you", "A biography the server will refuse.");
    await submitForm(root);
    await settle();

    // The request goes to the identity and is checked against the contract the
    // identity's route parses, so a schema change cannot leave this passing on
    // a shape the endpoint no longer accepts.
    const writes = requests.filter(({ method }) => method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ url: `/api/v1/identities/${IDENTITY_ID}`, method: "PATCH" });
    expect(identityUpdateSchema.parse(JSON.parse(writes[0].body!))).toMatchObject({
      biography: "A biography the server will refuse.",
    });
    expect(root.querySelector("form")?.textContent).toContain("Another editor saved first");
    // The form stays open, so the refused edit is still there to correct.
    expect(await markdownValue(root, "About you")).toBe("A biography the server will refuse.");
  });
});
