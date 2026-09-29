import { beginRecordEdit } from "./helpers/record-edit";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));
import type { ComponentChildren } from "preact";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { ProposalDetailPage } from "../../assets/ts/member-flows/portal/sections/events/detail/ProposalDetailPage";
import { proposalSpeakerAssetPath } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/SpeakerCard";
import { proposalPatchSchema } from "../../assets/shared/schemas/proposal-management";
import { markdownControl, markdownValue, submitForm, typeMarkdown } from "./helpers/labelled-control";
import { runCardAction } from "./helpers/row-actions";

import {
  EVENT_SLUG,
  PROPOSAL_ID,
  access,
  json,
  presentationVersion,
  settle,
  stubFetch,
  type RequestRecord,
} from "./helpers/proposal-detail-fixture";
let container: HTMLElement | null = null;

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

/**
 * Opens the record's actions menu and returns its items by label.
 *
 * The commands used to be eight block buttons in a sidebar panel; they are
 * one menu in the header now, reached the way a reader reaches it.
 */
async function openProposalActions(root: HTMLElement): Promise<HTMLButtonElement[]> {
  const trigger = root.querySelector<HTMLButtonElement>('button[aria-label="Proposal actions"]');
  if (!trigger) throw new Error("the proposal offers no actions menu");
  await act(async () => trigger.click());
  return [
    ...root.querySelectorAll<HTMLButtonElement>('[role="menu"][aria-label="Proposal actions"] [role="menuitem"]'),
  ];
}

/** The Panel whose header reads `title` — the migrated shape of a card. */
function panelTitled(root: HTMLElement, title: string): HTMLElement {
  const heading = Array.from(root.querySelectorAll<HTMLElement>(".pk-panel__title")).find(
    (candidate) => candidate.textContent?.trim() === title,
  );
  const panel = heading?.closest<HTMLElement>(".pk-panel");
  if (!panel) throw new Error(`no panel is titled "${title}"`);
  return panel;
}

describe("group event proposal portal", () => {
  it("uses the same canonical detail implementation from the event route", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, access, [presentationVersion]);
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    expect(container.textContent).toContain("Read-only proposal");
    expect(calls.some(({ url }) => url === `/api/v1/proposals/${PROPOSAL_ID}`)).toBe(true);
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some((button) =>
        button.textContent?.includes("Reviews"),
      ),
    ).toBe(false);
    expect(container.textContent).not.toContain("Edit");
    expect(container.textContent).not.toContain("Operator actions");
    expect(container.textContent).not.toContain("Open proposer manage page");
    expect(calls.filter(({ url }) => url === `/api/v1/proposals/${PROPOSAL_ID}/speakers`)).toHaveLength(0);
    const speakersTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Speakers"),
    );
    await act(async () => speakersTab?.click());
    await settle();
    expect(calls.filter(({ url }) => url === `/api/v1/proposals/${PROPOSAL_ID}/speakers`)).toHaveLength(1);

    const presentationTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Presentation"),
    );
    await act(async () => presentationTab?.click());
    await settle();
    expect(container.textContent).toContain("presentation.pdf");
    expect(container.textContent).toContain("Download");
    expect(container.textContent).not.toContain("Upload on behalf of speaker");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) => button.textContent?.trim() === "Review",
      ),
    ).toBe(false);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) => button.textContent?.trim() === "Delete",
      ),
    ).toBe(false);
  });

  it("does not fetch private reviews or comments for a read-only program identity", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls);
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    expect(container.textContent).toContain("Read-only proposal");
    expect(container.textContent).not.toContain("Internal Comments");
    expect(calls.some(({ url }) => url.includes("/reviews"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/comments"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/audit-log"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/decisions"))).toBe(false);
    expect(calls.some(({ url }) => url.endsWith(`/proposals/${PROPOSAL_ID}/speakers`))).toBe(false);
  });

  it("shows audit only to reviewers and never renders decision controls without finalize access", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    expect(container.textContent).toContain("Reviews");
    const auditTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Audit log"),
    );
    expect(auditTab).not.toBeNull();
    await act(async () => auditTab?.click());
    await settle();
    expect(container.textContent).toContain("Audit log");
    expect(container.textContent).not.toContain("Final decision");
    expect(calls.some(({ url }) => url.includes("/decisions"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/audit-log"))).toBe(true);
  });

  it("loads speakers through the canonical proposal resource and keeps all actions off admin paths", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, canFinalize: true, eventPermissions: ["proposals:manage"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <>
          <ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />
          <ConfirmDialogHost />
        </>,
        container!,
      ),
    );
    await settle();
    await settle();

    expect(container.textContent).toContain("Speakers");
    // The operator's commands are the record's actions menu, located by its
    // accessible name rather than by a substring of the whole page.
    const items = await openProposalActions(container);
    expect(items.map((item) => item.textContent?.trim())).toContain("Open proposer manage page");
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);

    const speakersTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Speakers"),
    );
    await act(async () => speakersTab?.click());
    await settle();
    expect(calls.filter(({ url }) => url.endsWith(`/proposals/${PROPOSAL_ID}/speakers`))).toHaveLength(1);

    // The speaker's commands sit behind the card's own menu.
    await runCardAction(container, "Proposal Speaker", "Edit profile");
    const form = container.querySelector('section[aria-label="Speaker Proposal Speaker"] form');
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(
      calls.some(
        ({ url, method }) =>
          method === "PATCH" && url.endsWith(`/speakers/${encodeURIComponent("40000000-0000-4000-8000-000000000001")}`),
      ),
    ).toBe(true);

    await runCardAction(container, "Proposal Speaker", "Send profile reminder");
    await settle();
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/reminders"))).toBe(true);

    await runCardAction(container, "Proposal Speaker", "Send presentation reminder");
    await settle();
    expect(calls.filter(({ url, method }) => method === "POST" && url.endsWith("/reminders"))).toHaveLength(2);

    await runCardAction(container, "Proposal Speaker", "Use Gravatar photo");
    await settle();
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/headshot"))).toBe(true);
    expect(proposalSpeakerAssetPath(PROPOSAL_ID, "speaker-1", "headshot")).toContain("/speakers/speaker-1/headshot");

    // Removing the proposer passes the proposal on: the replacement is chosen
    // in the card's own dialog before the removal is confirmed.
    await runCardAction(container, "Proposal Speaker", "Remove speaker");
    const removeDialog = container.querySelector<HTMLDialogElement>(
      'section[aria-label="Speaker Proposal Speaker"] ~ dialog, dialog',
    );
    expect(removeDialog).not.toBeNull();
    const replacement = removeDialog?.querySelector<HTMLSelectElement>("[data-replacement-proposer]");
    expect(replacement).not.toBeNull();
    await act(async () => {
      replacement!.value = "40000000-0000-4000-8000-000000000002";
      replacement!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      Array.from(removeDialog?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent?.trim() === "Remove speaker")
        ?.click();
    });
    await settle();
    expect(
      calls.some(({ url, method }) => method === "DELETE" && url.includes("/speakers/") && !url.endsWith("/speakers")),
    ).toBe(true);
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);
  });

  /**
   * The abstract editor is the one control on this page a reader types into,
   * and the class-name migration is exactly the change that can silently
   * detach a label from it: the old markup put a bare `<textarea>` under a
   * heading with nothing tying the two together, so the control announced
   * itself as an unnamed text box.
   */
  it("names the abstract editor and reports a rejected save without discarding the draft", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canFinalize: true, eventPermissions: ["proposals:manage"] });
    const passthrough = globalThis.fetch;
    const patchBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patchBodies.push(String(init.body));
          return json({ error: { code: "CONFLICT", message: "The abstract changed since you opened it" } }, 409);
        }
        return passthrough(input, init);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    const abstractPanel = panelTitled(container, "Abstract");
    await beginRecordEdit(abstractPanel, "Abstract actions", "Edit");

    // Resolving through the `for`/`id` pair fails exactly when the pair is
    // broken, which is the half a visual review cannot see.
    const editor = await markdownControl(abstractPanel, "Abstract");
    expect(editor.closest(".pk-markdown-editor")).not.toBeNull();

    const draft =
      "A revised abstract, long enough to satisfy the shared proposal contract, that the server will refuse anyway.";
    await typeMarkdown(abstractPanel, "Abstract", draft);
    await submitForm(abstractPanel);

    // The request is checked against the canonical contract rather than a
    // literal, so a schema change cannot leave this test passing on a shape
    // the endpoint no longer accepts.
    expect(patchBodies).toHaveLength(1);
    expect(proposalPatchSchema.parse(JSON.parse(patchBodies[0]))).toEqual({ abstract: draft });

    // A refused save keeps the editor — and what the reader typed — in place.
    expect(await markdownValue(panelTitled(container, "Abstract"), "Abstract")).toBe(draft);
  });

  it("summarizes the proposal beside its facets without leaning on colour to say whether quorum is met", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    // No band of stat cards restating the header; the record opens with its
    // subject, and what it is called is in the heading itself.
    expect(container.querySelector(".pk-stat-card")).toBeNull();
    expect(container.querySelector("h3.pk-profile-header__title")?.textContent).toBe("Read-only proposal");
    // Stored vocabulary is capitalized in the text itself, not by a CSS
    // transform a screen reader never sees.
    expect(container.querySelector(".pk-profile-header__lede")?.textContent).toBe("Talk · proposed by Proposal Owner");

    const standing = container.querySelector('section[aria-label="Review standing"]')!;
    expect(standing.textContent).toContain("0 of 2 required");
    expect(standing.querySelector(".pk-badge--warn")?.textContent).toBe("Quorum not met");
    expect(standing.textContent).toContain("Accepted");
  });
});
