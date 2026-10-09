// @vitest-environment jsdom
/**
 * What an operator can do to an accepted proposal from its own page: correct
 * the abstract the published program shows, open the proposer's management
 * page, and cancel the session. Each is a command with its own contract, and
 * the page owns the wiring between the panel that issues it and the record it
 * changes.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelAcceptedProposalSchema, proposalPatchSchema } from "../../assets/shared/schemas/proposal-management";
import { eventProposalDetailResponseSchema } from "../../assets/shared/schemas/event-proposals";
import { ProposalDetailPage } from "../../assets/ts/member-flows/portal/sections/events/detail/ProposalDetailPage";
import { beginRecordEdit } from "./helpers/record-edit";
import { markdownValue, submitForm, typeMarkdown } from "./helpers/labelled-control";
import { json, PROPOSAL_ID, EVENT_SLUG, proposal, settle } from "./helpers/proposal-detail-fixture";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

const CORRECTED_ABSTRACT =
  "A corrected accepted abstract for the published program, long enough to satisfy the shared proposal contract.";
const MANAGE_URL = "https://app.test/propose-manage/?event=pqc-2026&token=proposal-token";
const operatorAccess = {
  eventPermissions: ["review", "finalize"],
  canRead: true,
  canReview: true,
  canFinalize: true,
  canEditAcceptedAbstract: true,
  canCancelAcceptedProposal: true,
};

const fields = [
  { key: "audience", label: "Target audience", fieldType: "text", required: true, options: null },
  {
    key: "format",
    label: "Preferred format",
    fieldType: "select",
    required: true,
    options: [
      { value: "talk", label: "Talk" },
      { value: "panel", label: "Panel discussion" },
    ],
  },
  {
    key: "tracks",
    label: "Tracks",
    fieldType: "multi_select",
    required: false,
    options: [
      { value: "pki", label: "PKI" },
      { value: "policy", label: "Policy" },
    ],
  },
].map((field, index) => ({
  ...field,
  id: String(index + 1).repeat(32),
  optionSource: null,
  validation: null,
  sortOrder: index + 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
}));

let container: HTMLElement | null = null;

/** An accepted proposal that keeps whatever the operator last changed about it. */
function stubAcceptedProposal() {
  const record = {
    ...proposal(),
    status: "accepted",
    decision_status: "accepted",
    canceled_at: null as string | null,
    cancellation_comment: null as string | null,
    details: { audience: "Platform operators", format: "panel", tracks: ["pki", "policy"] },
  };
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (method !== "GET") writes.push({ method, path, body });
      if (path === `/api/v1/proposals/${PROPOSAL_ID}` && method === "PATCH") {
        record.abstract = body.abstract;
        return json({
          proposal: { id: PROPOSAL_ID, title: record.title, abstract: record.abstract, updated_at: "now" },
        });
      }
      if (path === `/api/v1/proposals/${PROPOSAL_ID}/cancellations`) {
        Object.assign(record, {
          status: "canceled",
          canceled_at: "2026-08-03T00:00:00.000Z",
          cancellation_comment: body.comment,
        });
        return json({
          success: true,
          proposalId: PROPOSAL_ID.replaceAll("-", ""),
          status: "canceled",
          canceledAt: record.canceled_at,
          notifiedSpeakerCount: 1,
        });
      }
      if (path === `/api/v1/proposals/${PROPOSAL_ID}/access-links`) return json({ manageUrl: MANAGE_URL });
      if (path === `/api/v1/proposals/${PROPOSAL_ID}`) {
        return json(
          eventProposalDetailResponseSchema.parse({
            event: { startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T17:00:00.000Z", timezone: "UTC" },
            proposal: record,
            access: operatorAccess,
            form: { id: "3".repeat(32), title: "CFP Form", description: null, fields },
            minReviewsRequired: 2,
            sessionTypes: [{ label: "talk", requiresPresentation: true }],
          }),
        );
      }
      if (path.endsWith("/reviews")) {
        return json({
          proposalId: PROPOSAL_ID,
          reviews: [],
          myReview: null,
          summary: {
            totalReviews: 1,
            averageScore: 9,
            acceptCount: 1,
            needsWorkCount: 0,
            rejectCount: 0,
            minReviewsRequired: 2,
            quorumMet: false,
          },
          page: { limit: 25, offset: 0, total: 0, hasMore: false },
        });
      }
      if (path.endsWith("/comments"))
        return json({ comments: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      return json({ error: { code: "UNEXPECTED", message: path } }, 500);
    }),
  );
  return writes;
}

async function mount(tab?: string): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(() =>
    render(
      <ProposalDetailPage
        slug={EVENT_SLUG}
        proposalId={PROPOSAL_ID}
        tab={tab}
        tabHref={(key) => `/proposals/${key}`}
      />,
      container!,
    ),
  );
  await settle();
  await settle();
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an accepted proposal's own page", () => {
  it("files each submission answer under its question and states the review standing", async () => {
    stubAcceptedProposal();
    const root = await mount();

    const answers = [...root.querySelectorAll("dl.pk-datalist")].find((list) =>
      list.textContent?.includes("Target audience"),
    )!;
    const pairs = [...answers.querySelectorAll(":scope > dt")].map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent,
    ]);
    // The stored option value is shown as the label the form gave it.
    expect(pairs).toEqual([
      ["Target audience", "Platform operators"],
      ["Preferred format", "Panel discussion"],
      ["Tracks", "PKIPolicy"],
    ]);
    expect([...answers.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["PKI", "Policy"]);
    expect(root.querySelector('section[aria-label="Review standing"]')?.textContent).toContain("1 of 2 required");
  });

  it("corrects the abstract of an accepted session through the proposal contract and shows the corrected text", async () => {
    const writes = stubAcceptedProposal();
    const root = await mount();
    const panel = [...root.querySelectorAll<HTMLElement>(".pk-panel")].find(
      (candidate) => candidate.querySelector(".pk-panel__title")?.textContent === "Abstract",
    )!;

    await beginRecordEdit(panel, "Abstract actions", "Edit");
    await typeMarkdown(panel, "Abstract", CORRECTED_ABSTRACT);
    expect(await markdownValue(panel, "Abstract")).toBe(CORRECTED_ABSTRACT);
    await submitForm(panel);
    await settle();

    // Only the abstract is sent: the title of an accepted session is not this form's to change.
    const patch = writes.find(({ method }) => method === "PATCH")!;
    expect(proposalPatchSchema.parse(patch.body)).toEqual({
      abstract: CORRECTED_ABSTRACT,
    });
    expect(root.textContent).toContain(CORRECTED_ABSTRACT);
  });

  it("opens the proposer's management page in a new tab from the capability the server issues", async () => {
    const writes = stubAcceptedProposal();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const root = await mount();

    await act(async () => root.querySelector<HTMLButtonElement>('button[aria-label="Proposal actions"]')!.click());
    const manage = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Open proposer manage page",
    )!;
    await act(async () => manage.click());
    await settle();

    expect(writes.find(({ path }) => path.endsWith("/access-links"))?.method).toBe("POST");
    expect(open).toHaveBeenCalledWith(MANAGE_URL, "_blank", "noopener");
  });

  it("cancels the session with a comment to the speakers and then states the cancellation", async () => {
    const writes = stubAcceptedProposal();
    const root = await mount("decision");

    await typeMarkdown(root, "Comment to speakers", "The speaker is unavailable for the scheduled session.");
    const confirmation = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      confirmation.checked = true;
      confirmation.dispatchEvent(new Event("input", { bubbles: true }));
      confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submitForm(root);
    await settle();
    await settle();

    const request = writes.find(({ path }) => path.endsWith("/cancellations"))!;
    expect(cancelAcceptedProposalSchema.parse(request.body)).toEqual({
      comment: "The speaker is unavailable for the scheduled session.",
    });
    expect(root.textContent).toContain("Session canceled");
    expect(root.textContent).toContain("The speaker is unavailable for the scheduled session.");
    expect([...root.querySelectorAll("button")].map((button) => button.textContent)).not.toContain(
      "Cancel accepted session",
    );
  });
});
