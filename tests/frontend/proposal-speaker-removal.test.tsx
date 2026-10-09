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
import { proposalSpeakerAssetPath } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/proposal-api";
import { ProposalSpeakerCard } from "../../assets/ts/components/proposals/ProposalSpeakerCard";
import {
  proposalSpeakerPatchSchema,
  proposerSpeakerPatchSchema,
} from "../../assets/shared/schemas/proposal-management";
import { ProposalManageSpeakerCard, SpeakerList } from "../../assets/ts/components/proposals/ProposerSpeakerList";
import { PROPOSAL_SPEAKER_ROLES } from "../../assets/shared/schemas/participant-roles";
import {
  controlFor,
  labelNames,
  markdownControl,
  markdownValue,
  optionValues,
  submitForm,
  typeMarkdown,
  typeInto,
} from "./helpers/labelled-control";
import { openCardMenu, runCardAction } from "./helpers/row-actions";
import { confirmationButton, confirmationConsequences } from "./helpers/confirm-dialog";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";

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
    bio: null,
    headshotUploaded: false,
    ...overrides,
  };
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

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

describe("proposal speaker removal UI", () => {
  it("keeps admin headshot operations scoped to the proposal speaker", async () => {
    expect(proposalSpeakerAssetPath("proposal/1", "user/1", "headshot")).toBe(
      "/api/v1/proposals/proposal%2F1/speakers/user%2F1/headshot",
    );
    expect(proposalSpeakerAssetPath("proposal-1", "user-1", "gravatar")).toBe(
      "/api/v1/proposals/proposal-1/speakers/user-1/headshot",
    );
  });

  it("shows proposal reviewers the headshot without mutation controls", async () => {
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

    expect(root.querySelector<HTMLImageElement>(`img[alt="Casey Speaker's photo"]`)?.src).toContain(
      "/api/v1/proposals/proposal-1/speakers/speaker-1/headshot",
    );
    // The read-only tile is the photo alone: it is not a control, and nothing
    // beside it changes or removes it.
    expect(root.querySelector('button[aria-label$="photo of Casey Speaker"]')).toBeNull();
    expect(root.querySelector('input[type="file"]')).toBeNull();
    expect(root.textContent).not.toContain("Fetch from Gravatar");
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

    // The commands sit behind the card's own menu, named for the speaker.
    await runCardAction(root, "Casey Speaker", "Send profile reminder");
    await settle();
    expect(requests[0]).toMatchObject({
      url: "/api/v1/proposals/proposal-1/speakers/speaker-1/reminders",
      method: "POST",
      body: JSON.stringify({ kind: "profile" }),
    });

    // The Gravatar import is a command on the same menu; the photo itself is
    // the shared picture tile, which carries the upload and the remove.
    await runCardAction(root, "Casey Speaker", "Use Gravatar photo");
    await settle();
    expect(requests[1]).toMatchObject({
      url: "/api/v1/proposals/proposal-1/speakers/speaker-1/headshot",
      method: "POST",
      body: JSON.stringify({ source: "gravatar" }),
    });
    expect(requests.every(({ url }) => !url.includes("/api/v1/admin/"))).toBe(true);
  });

  it("keeps the roster read-only until one speaker is selected and preserves owner role rules", async () => {
    const root = mount(
      <SpeakerList
        speakers={[managedSpeaker(), managedSpeaker({ userId: "proposer-1", role: "moderator", firstName: "Owner" })]}
        token="manage-token"
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );
    expect(root.querySelectorAll("[data-speaker-card]")).toHaveLength(2);
    expect(root.querySelector("form")).toBeNull();
    // The roster shows each photo read-only; changing it belongs to the editor.
    expect(root.querySelector('button[aria-label^="Upload photo"]')).toBeNull();
    const memberActions = await openCardMenu(root, "Casey Speaker");
    expect(memberActions.map((action) => action.textContent)).toContain("Remove speaker");
    await act(() => memberActions.find((action) => action.textContent === "Edit speaker details")!.click());
    expect(root.querySelectorAll("[data-speaker-card]")).toHaveLength(1);
    // In the editor the photo itself is the control, named for the speaker.
    expect(root.querySelector('button[aria-label="Upload photo of Casey Speaker"]')).not.toBeNull();
    expect(optionValues(controlFor<HTMLSelectElement>(root, "Role"))).not.toContain("proposer");
    await typeInto(controlFor(root, "Organization"), "Unsaved organization");
    await act(() => [...root.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click());
    expect(root.querySelector("form")).toBeNull();
    await runCardAction(root, "Casey Speaker", "Edit speaker details");
    expect(controlFor<HTMLInputElement>(root, "Organization").value).toBe("");
    await act(() => [...root.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click());
    const ownerActions = await openCardMenu(root, "Owner Speaker");
    expect(ownerActions.map((action) => action.textContent)).not.toContain("Remove speaker");
    await act(() => ownerActions.find((action) => action.textContent === "Edit speaker details")!.click());
    expect(controlFor<HTMLSelectElement>(root, "Role").value).toBe("moderator");
    expect(optionValues(controlFor<HTMLSelectElement>(root, "Role"))).toEqual(
      expect.arrayContaining(["proposer", "moderator", "speaker"]),
    );
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
        canEdit
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

  it("surfaces final-speaker guidance instead of an admin removal action", async () => {
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

    const items = await openCardMenu(root, "Casey Speaker");
    expect(items.map((item) => item.textContent?.trim())).not.toContain("Remove speaker");
    expect(root.textContent).toContain("every proposal must retain its speaker roster");
  });

  /**
   * The edit form used to be bare `<label>`s beside bare inputs with nothing
   * tying either pair together, so every control in it announced itself
   * unnamed. Assert the association rather than the appearance: that is the
   * half a visual review cannot see.
   */
  it("gives every editable speaker field a name a screen reader can reach", async () => {
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

    await runCardAction(root, "Casey Speaker", "Edit profile");

    const form = root.querySelector("form")!;
    expect(labelNames(form)).toEqual(["First name", "Last name", "Organization", "Job title", "Role", "Biography"]);
    // Resolving through the `for`/`id` pair fails exactly when the pair is
    // broken, so this asserts the contract rather than the markup.
    expect(controlFor(form, "Role").tagName.toLowerCase()).toBe("select");
    // The biography is the shared Markdown editor (#114), a textbox canvas.
    expect((await markdownControl(form, "Biography")).getAttribute("role")).toBe("textbox");

    // ProfileLinksInput names its own controls, so the surrounding group is
    // named by the heading beside it rather than by an orphaned `for`.
    // The editor's toolbar is a group of its own; the links group is the
    // one the form names.
    const group = form.querySelector<HTMLElement>('[role="group"][aria-labelledby]');
    const groupName = group?.getAttribute("aria-labelledby");
    expect(groupName).toBeTruthy();
    expect(root.ownerDocument.getElementById(groupName!)?.textContent?.trim()).toBe("Profile links");
  });

  it("offers a co-speaker every role in the contract except the proposer's", async () => {
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

    await runCardAction(root, "Casey Speaker", "Edit profile");

    // Derived from the vocabulary rather than listed here: a role added to the
    // contract becomes available to every speaker but the proposer, whose role
    // moves by promoting someone else.
    expect(optionValues(controlFor<HTMLSelectElement>(root, "Role"))).toEqual(
      PROPOSAL_SPEAKER_ROLES.filter((role) => role !== "proposer"),
    );
  });

  it("holds the proposer's own card to the proposer role", async () => {
    const root = mount(
      <SpeakerCard
        speaker={proposalSpeaker({ role: "proposer" })}
        proposalId="proposal-1"
        canEdit
        isCurrentProposer
        replacementSpeakers={[]}
        onSaved={() => {}}
        onRemoved={() => {}}
      />,
    );

    await runCardAction(root, "Casey Speaker", "Edit profile");

    expect(optionValues(controlFor<HTMLSelectElement>(root, "Role"))).toEqual(["proposer"]);
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

    await runCardAction(root, "Casey Speaker", "Edit profile");
    await typeMarkdown(root, "Biography", "A biography the server will refuse.");
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
    expect(await markdownValue(root, "Biography")).toBe("A biography the server will refuse.");
  });

  it("names the selected managed speaker and ties its biography guidance to the control", async () => {
    const root = mount(
      <SpeakerList
        speakers={[managedSpeaker()]}
        token="manage-token"
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );
    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Speaker Casey Speaker");
    await runCardAction(root, "Casey Speaker", "Edit speaker details");
    expect(labelNames(root)).toEqual(["First name", "Last name", "Role", "Organization", "Job title", "Biography"]);
    expect(root.querySelector<HTMLFormElement>("form")?.noValidate).toBe(true);
    const biography = await markdownControl(root, "Biography");
    const help = root.querySelector(`#${biography.getAttribute("aria-describedby")!}`);
    expect(help?.textContent).toBe("Visible to attendees on the event program.");
  });

  it("returns focus to the record menu and prevents duplicate removal while pending", async () => {
    let resolveRemoval: (() => void) | undefined;
    const fetch = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          resolveRemoval = () =>
            resolve(
              Response.json({
                success: true,
                removedUserId: "00000000-0000-4000-8000-000000000001",
                proposerUserId: "00000000-0000-4000-8000-000000000002",
                cancelledEmailCount: 0,
              }),
            );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const root = mount(
      <>
        <ProposalManageSpeakerCard
          speaker={managedSpeaker()}
          token="manage-token"
          apiBase="/api/v1"
          isCurrentProposer={false}
          onEdit={() => {}}
          onReload={async () => {}}
          onStatus={() => {}}
        />
        <ConfirmDialogHost />
      </>,
    );
    await runCardAction(root, "Casey Speaker", "Remove speaker");
    // The removal is confirmed in the in-page dialog, which keeps the profile and history.
    expect(confirmationConsequences()).toEqual(["Their user profile and proposal history are kept."]);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      confirmationButton("Remove speaker")!.click();
      await Promise.resolve();
    });
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-label="Actions for Casey Speaker"]')!;
    expect(document.activeElement).toBe(trigger);
    expect(root.textContent).toContain("Removing speaker…");
    const actions = await openCardMenu(root, "Casey Speaker");
    expect(actions.find((action) => action.textContent === "Remove speaker")?.disabled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveRemoval?.();
    await settle();
  });

  it("validates the editorial contract before transport and retains draft on a field refusal", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the job title",
            details: { fieldErrors: { jobTitle: ["This title needs correction"] } },
          },
        },
        { status: 400 },
      );
    });
    vi.stubGlobal("fetch", fetch);
    const reload = vi.fn(async () => {});
    const root = mount(
      <SpeakerList
        speakers={[managedSpeaker({ links: ["https://example.test/profile"] })]}
        token={{ resourceId: "proposal-1" }}
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={reload}
        onStatus={() => {}}
      />,
    );
    await runCardAction(root, "Casey Speaker", "Edit speaker details");
    await typeInto(controlFor(root, "First name"), "X".repeat(1000));
    await submitForm(root);
    expect(fetch).not.toHaveBeenCalled();
    expect(controlFor(root, "First name").getAttribute("aria-invalid")).toBe("true");
    await typeInto(controlFor(root, "First name"), "Authored Casey");
    await typeInto(controlFor(root, "Job title"), "Authored job title");
    await submitForm(root);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/proposals/proposal-1/submission/speakers/speaker-1");
    expect(proposerSpeakerPatchSchema.parse(requests[0].body)).toMatchObject({
      firstName: "Authored Casey",
      jobTitle: "Authored job title",
      role: "co_speaker",
      links: ["https://example.test/profile"],
    });
    expect(controlFor(root, "Job title").getAttribute("aria-invalid")).toBe("true");
    expect(root.textContent).toContain("This title needs correction");
    expect(controlFor<HTMLInputElement>(root, "First name").value).toBe("Authored Casey");
    expect(reload).not.toHaveBeenCalled();
  });

  it("saves the same capability resource and returns to the roster after canonical reload", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return Response.json({ success: true });
      }),
    );
    const reload = vi.fn(async () => {});
    const root = mount(
      <SpeakerList
        speakers={[managedSpeaker()]}
        token="manage-token"
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={reload}
        onStatus={() => {}}
      />,
    );
    await runCardAction(root, "Casey Speaker", "Edit speaker details");
    await typeInto(controlFor(root, "Organization"), "Proposal editorial organization");
    await submitForm(root);
    expect(requests[0].url).toBe("/api/v1/proposals/access/manage-token/speakers/speaker-1");
    expect(proposerSpeakerPatchSchema.parse(requests[0].body)).toMatchObject({
      organizationName: "Proposal editorial organization",
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(root.querySelector("form")).toBeNull();
    await runCardAction(root, "Casey Speaker", "Edit speaker details");
    expect(controlFor<HTMLInputElement>(root, "Organization").value).toBe("");
  });

  it("says the roster is empty in words rather than rendering nothing", async () => {
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
