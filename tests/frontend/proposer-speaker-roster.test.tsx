// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import {
  proposalSpeakerPatchSchema,
  type ProposalAccessResponse,
} from "../../assets/shared/schemas/proposal-management";
import { ProposalManageSpeakerCard, SpeakerList } from "../../assets/ts/components/proposals/ProposerSpeakerList";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { controlFor, labelNames, optionValues, submitForm } from "./helpers/labeled-control";
import { openCardMenu, runCardAction } from "./helpers/row-actions";
import { confirmationButton, confirmationConsequences } from "./helpers/confirm-dialog";

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
    declineReason: null,
    bio: null,
    headshotUploaded: false,
    ...overrides,
  };
}

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

describe("proposer-managed speaker roster", () => {
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
    // The photo is the person's own: the roster never offers to change it.
    expect(root.querySelector('button[aria-label^="Upload photo"]')).toBeNull();
    const memberActions = await openCardMenu(root, "Casey Speaker");
    expect(memberActions.map((action) => action.textContent)).toContain("Remove speaker");
    await act(() => memberActions.find((action) => action.textContent === "Change role…")!.click());
    expect(root.querySelectorAll("[data-speaker-card]")).toHaveLength(1);
    expect(root.querySelector('button[aria-label^="Upload photo"]')).toBeNull();
    expect(optionValues(controlFor<HTMLSelectElement>(root, "Role"))).not.toContain("proposer");
    await act(() => [...root.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click());
    expect(root.querySelector("form")).toBeNull();
    const ownerActions = await openCardMenu(root, "Owner Speaker");
    expect(ownerActions.map((action) => action.textContent)).not.toContain("Remove speaker");
    await act(() => ownerActions.find((action) => action.textContent === "Change role…")!.click());
    expect(controlFor<HTMLSelectElement>(root, "Role").value).toBe("moderator");
    expect(optionValues(controlFor<HTMLSelectElement>(root, "Role"))).toEqual(
      expect.arrayContaining(["proposer", "moderator", "speaker"]),
    );
  });

  it("tells the proposer why a speaker declined", async () => {
    const root = mount(
      <SpeakerList
        speakers={[
          managedSpeaker({
            status: "declined",
            declinedAt: "2026-08-02T00:00:00.000Z",
            declineReason: "I am traveling that week.",
          }),
        ]}
        token="manage-token"
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );
    expect(root.textContent).toContain("Reason for declining: I am traveling that week.");
  });

  it("titles an invited speaker without a name by the address once, not twice", async () => {
    const root = mount(
      <SpeakerList
        speakers={[managedSpeaker({ status: "invited", firstName: null, lastName: null, confirmedAt: null })]}
        token="manage-token"
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );
    const card = root.querySelector("[data-speaker-card]")!;
    expect(card.textContent?.split("speaker@example.test")).toHaveLength(2);
  });

  it("shows the speaker's identity read-only and edits only their role", async () => {
    const root = mount(
      <SpeakerList
        speakers={[managedSpeaker({ organizationName: "Example Labs", jobTitle: "Engineer" })]}
        token="manage-token"
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={async () => {}}
        onStatus={() => {}}
      />,
    );
    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Speaker Casey Speaker");
    await runCardAction(root, "Casey Speaker", "Change role…");
    // Organization and title come from the speaker's identity: shown, never edited here.
    const details = root.querySelector("dl")?.textContent ?? "";
    expect(details).toContain("Example Labs");
    expect(details).toContain("Engineer");
    expect(labelNames(root)).toEqual(["Role"]);
    expect(root.querySelector<HTMLFormElement>("form")?.noValidate).toBe(true);
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

  it("shows a refused role change on the field and keeps the draft", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the role",
            details: { fieldErrors: { role: ["This role is not available"] } },
          },
        },
        { status: 400 },
      );
    });
    vi.stubGlobal("fetch", fetch);
    const reload = vi.fn(async () => {});
    const root = mount(
      <SpeakerList
        speakers={[managedSpeaker()]}
        token={{ resourceId: "proposal-1" }}
        apiBase="/api/v1"
        proposerUserId="proposer-1"
        onReload={reload}
        onStatus={() => {}}
      />,
    );
    await runCardAction(root, "Casey Speaker", "Change role…");
    const role = controlFor<HTMLSelectElement>(root, "Role");
    await act(() => {
      role.value = "moderator";
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submitForm(root);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/proposals/proposal-1/submission/speakers/speaker-1");
    expect(proposalSpeakerPatchSchema.parse(requests[0].body)).toEqual({ role: "moderator" });
    expect(controlFor(root, "Role").getAttribute("aria-invalid")).toBe("true");
    expect(root.textContent).toContain("This role is not available");
    expect(controlFor<HTMLSelectElement>(root, "Role").value).toBe("moderator");
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
    await runCardAction(root, "Casey Speaker", "Change role…");
    const role = controlFor<HTMLSelectElement>(root, "Role");
    await act(() => {
      role.value = "panelist";
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submitForm(root);
    expect(requests[0].url).toBe("/api/v1/proposals/access/manage-token/speakers/speaker-1");
    expect(proposalSpeakerPatchSchema.parse(requests[0].body)).toEqual({ role: "panelist" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(root.querySelector("form")).toBeNull();
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
