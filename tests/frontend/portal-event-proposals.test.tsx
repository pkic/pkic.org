// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupEventProposals } from "../../assets/ts/member-flows/portal/sections/management/GroupEventProposals";
import { ProposalDetailPage } from "../../assets/ts/member-flows/portal/sections/events/detail/ProposalDetailPage";
import { proposalSpeakerAssetPath } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/SpeakerCard";
import { proposalPatchSchema } from "../../assets/shared/schemas/proposal-management";
import { buttonNamed, controlFor, submitForm, typeInto } from "./helpers/labelled-control";
import { isCurrentTab, tabs } from "./helpers/tabs";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const EVENT_SLUG = "event";
const PROPOSAL_ID = "30000000-0000-4000-8000-000000000001";
let container: HTMLElement | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const access = {
  eventPermissions: ["proposals:read"],
  canRead: true,
  canReview: false,
  canFinalize: false,
  canEditAcceptedAbstract: false,
  canCancelAcceptedProposal: false,
};

function proposal() {
  return {
    id: PROPOSAL_ID,
    event_id: EVENT_ID,
    proposer_user_id: "40000000-0000-4000-8000-000000000001",
    status: "submitted",
    proposal_type: "talk",
    title: "Read-only proposal",
    abstract: "A sufficiently long abstract for the program committee detail view.",
    review_round: 1,
    submitted_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    proposer_email: "proposer@example.test",
    proposer_first_name: "Proposal",
    proposer_last_name: "Owner",
    decision_status: "accepted",
    decision_note: null,
    decision_decided_at: null,
    review_count: 0,
    average_review_score: null,
    recommendation_accept_count: 0,
    recommendation_needs_work_count: 0,
    recommendation_reject_count: 0,
  };
}

function speaker(userId: string, role: "proposer" | "speaker" = "speaker") {
  return {
    userId,
    role,
    status: "confirmed",
    email: `${userId}@example.test`,
    firstName: userId.endsWith("0001") ? "Proposal" : "Second",
    lastName: "Speaker",
    organizationName: "PKI Consortium",
    jobTitle: "Researcher",
    links: [],
    headshotUpdatedAt: null,
    headshotUrl: null,
    confirmedAt: "2026-08-01T00:00:00.000Z",
    declinedAt: null,
    declineReason: null,
    inviteExpiresAt: null,
    termsAcceptedAt: null,
    addedAt: "2026-08-01T00:00:00.000Z",
    biography: "A speaker biography.",
    profileComplete: false,
    hasHeadshot: false,
    hasBio: true,
  };
}

type RequestRecord = { url: string; method: string };
type DetailAccess = typeof access | (() => typeof access);

const presentationVersion = {
  id: "50000000-0000-4000-8000-000000000001",
  proposalId: PROPOSAL_ID,
  versionNumber: 1,
  fileName: "presentation.pdf",
  fileSize: 1024,
  mimeType: "application/pdf",
  uploadedByUserId: "40000000-0000-4000-8000-000000000001",
  uploadedAt: "2026-08-02T00:00:00.000Z",
  isCurrent: true,
  deletedAt: null,
  latestReview: null,
};

function stubFetch(
  calls: RequestRecord[],
  detailAccess: DetailAccess = access,
  presentationVersions: (typeof presentationVersion)[] = [],
): void {
  const currentAccess = () => (typeof detailAccess === "function" ? detailAccess() : detailAccess);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.startsWith("/api/v1/proposals/programs")) {
        return json({
          programs: [
            {
              group: { id: GROUP_ID, slug: "working-group", name: "Working Group" },
              event: { id: EVENT_ID, slug: "event", name: "Program Event", startsAt: null },
              access: currentAccess(),
            },
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/events/${EVENT_SLUG}/proposals?`)) {
        return json({
          event: { id: EVENT_ID, slug: "event", name: "Program Event" },
          access: currentAccess(),
          proposals: [proposal()],
          stats: {
            byStatus: { submitted: 1 },
            byRecommendation: {},
            reviewedCount: 0,
            unreviewedCount: 1,
            total: 1,
          },
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url === `/api/v1/proposals/${PROPOSAL_ID}`) {
        return json({
          event: {
            startsAt: "2026-09-01T09:00:00.000Z",
            endsAt: "2026-09-01T17:00:00.000Z",
            timezone: "UTC",
          },
          proposal: { ...proposal(), details: null, canceled_at: null, cancellation_comment: null },
          access: currentAccess(),
          form: null,
          minReviewsRequired: 2,
          sessionTypes: [{ label: "talk", requiresPresentation: true }],
        });
      }
      if (url === `/api/v1/proposals/${PROPOSAL_ID}/speakers`) {
        return json({
          proposal: {
            id: PROPOSAL_ID,
            title: "Read-only proposal",
            status: "submitted",
            presentationDeadline: null,
            presentationUploaded: false,
            presentationUploadedAt: null,
          },
          summary: { total: 2, confirmed: 2, pending: 0, declined: 0, profileComplete: 0, presentationUploaded: 0 },
          speakers: [
            speaker("40000000-0000-4000-8000-000000000001", "proposer"),
            speaker("40000000-0000-4000-8000-000000000002"),
          ],
        });
      }
      if (url.startsWith(`/api/v1/proposals/${PROPOSAL_ID}/audit-log`)) {
        return json({
          auditLog: [
            {
              id: "audit-1",
              created_at: "2026-08-21T12:00:00.000Z",
              actor_type: "admin",
              actor_id: "reviewer-1",
              actor_display: "Reviewer",
              action: "proposal_decision_recorded",
              entity_type: "proposal",
              entity_id: PROPOSAL_ID,
              details: { finalStatus: "accepted" },
            },
          ],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/proposals/${PROPOSAL_ID}/reviews`)) {
        return json({
          proposalId: PROPOSAL_ID,
          reviews: [],
          myReview: null,
          summary: {
            totalReviews: 0,
            averageScore: null,
            acceptCount: 0,
            needsWorkCount: 0,
            rejectCount: 0,
            minReviewsRequired: 2,
            quorumMet: false,
          },
          page: { limit: 25, offset: 0, total: 0, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/proposals/${PROPOSAL_ID}/comments`)) {
        return json({ comments: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }
      if (url.startsWith(`/api/v1/proposals/${PROPOSAL_ID}/presentations`)) {
        return json({
          versions: presentationVersions,
          page: { limit: 25, offset: 0, total: presentationVersions.length, hasMore: false },
        });
      }
      return json({ error: { code: "UNEXPECTED", message: url } }, 500);
    }),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

/**
 * Opens a proposal the way a person does.
 *
 * These used to dispatch a click at the `<tr>`, which matched the old
 * implementation's handler on the row — an affordance no keyboard could reach.
 * The row's control is now a real button; clicking that is both what a mouse
 * does and what Enter does.
 */
function rowControl(container: HTMLElement): HTMLElement {
  const control = container.querySelector<HTMLElement>("tbody .pk-table__row-link");
  if (!control) throw new Error("the table row offers no control to activate");
  return control;
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

  it("opens the tab named in a preset hash query instead of the default submission tab", async () => {
    const previousHash = window.location.hash;
    window.location.hash = "#/x?proposalTab=reviews";
    try {
      const calls: RequestRecord[] = [];
      stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
      container = document.createElement("div");
      document.body.append(container);
      await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
      await settle();
      await settle();

      const activeTab = tabs(container).find(isCurrentTab);
      expect(activeTab?.textContent).toBe("Reviews (0)");
    } finally {
      window.location.hash = previousHash;
    }
  });

  it("does not fetch private reviews or comments for a read-only program identity", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls);
    container = document.createElement("div");
    document.body.append(container);
    void act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();

    await act(async () => rowControl(container!).click());
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
    await act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();
    await act(async () => rowControl(container!).click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Reviews");
    const auditTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Audit Log"),
    );
    expect(auditTab).not.toBeNull();
    await act(async () => auditTab?.click());
    await settle();
    expect(container.textContent).toContain("Audit Log");
    expect(container.textContent).not.toContain("Final decision");
    expect(calls.some(({ url }) => url.includes("/decisions"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/audit-log"))).toBe(true);
  });

  it("returns to submission when live reviewer access is removed", async () => {
    let currentAccess: typeof access = { ...access, canReview: true, eventPermissions: ["proposals:score"] };
    const calls: RequestRecord[] = [];
    stubFetch(calls, () => currentAccess);
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    const reviewsTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Reviews"),
    );
    await act(async () => reviewsTab?.click());
    expect(container.textContent).toContain("Reviews");

    currentAccess = { ...access };
    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Refresh"),
    );
    await act(async () => refresh?.click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Abstract");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some((button) =>
        button.textContent?.includes("Reviews"),
      ),
    ).toBe(false);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some((button) =>
        button.textContent?.includes("Audit Log"),
      ),
    ).toBe(false);
  });

  it("loads speakers through the canonical proposal resource and keeps all actions off admin paths", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, canFinalize: true, eventPermissions: ["proposals:manage"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <>
          <GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />
          <ConfirmDialogHost />
        </>,
        container!,
      ),
    );
    await settle();
    await settle();
    await act(async () => rowControl(container!).click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Speakers");
    // The sidebar's operator panel, located by its heading and its control's
    // accessible name rather than by a substring of the whole page, so a
    // rename surfaces here as the panel going missing.
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toContain("Operator actions");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Open proposer manage page",
      ),
    ).toBe(true);
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);

    const speakersTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Speakers"),
    );
    await act(async () => speakersTab?.click());
    await settle();
    expect(calls.filter(({ url }) => url.endsWith(`/proposals/${PROPOSAL_ID}/speakers`))).toHaveLength(1);

    const edit = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Edit profile"),
    );
    expect(edit).not.toBeNull();
    await act(async () => edit?.click());
    // The speaker card is a design-system Panel now, not a Bootstrap card.
    const form = edit?.closest(".pk-panel")?.querySelector("form");
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

    const profileReminder = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Profile reminder"),
    );
    await act(async () => profileReminder?.click());
    await settle();
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/reminders"))).toBe(true);

    const presentationReminder = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Presentation reminder"),
    );
    await act(async () => presentationReminder?.click());
    await settle();
    expect(calls.filter(({ url, method }) => method === "POST" && url.endsWith("/reminders"))).toHaveLength(2);

    const gravatar = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Fetch from Gravatar"),
    );
    await act(async () => gravatar?.click());
    await settle();
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/headshot"))).toBe(true);
    expect(proposalSpeakerAssetPath(PROPOSAL_ID, "speaker-1", "headshot")).toContain("/speakers/speaker-1/headshot");

    const remove = container.querySelector<HTMLButtonElement>("[data-remove-proposal-speaker]");
    const replacement = container.querySelector<HTMLSelectElement>("[data-replacement-proposer]");
    if (replacement) {
      await act(async () => {
        replacement.value = "40000000-0000-4000-8000-000000000002";
        replacement.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await act(async () => remove?.click());
    await settle();
    const removeDialog = document.querySelector('[role="alertdialog"]');
    expect(removeDialog).not.toBeNull();
    await act(async () => {
      Array.from(removeDialog?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent === "Remove speaker")
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
    await act(async () => buttonNamed(abstractPanel, "Edit").click());

    // Resolving through the `for`/`id` pair fails exactly when the pair is
    // broken, which is the half a visual review cannot see.
    const editor = controlFor(abstractPanel, "Abstract");
    expect(editor.tagName.toLowerCase()).toBe("textarea");

    const draft =
      "A revised abstract, long enough to satisfy the shared proposal contract, that the server will refuse anyway.";
    await typeInto(editor, draft);
    await submitForm(abstractPanel);

    // The request is checked against the canonical contract rather than a
    // literal, so a schema change cannot leave this test passing on a shape
    // the endpoint no longer accepts.
    expect(patchBodies).toHaveLength(1);
    expect(proposalPatchSchema.parse(JSON.parse(patchBodies[0]))).toEqual({ abstract: draft });

    // A refused save keeps the editor — and what the reader typed — in place.
    const stillEditing = controlFor(panelTitled(container, "Abstract"), "Abstract") as HTMLTextAreaElement;
    expect(stillEditing.value).toBe(draft);
  });

  it("summarizes the proposal without leaning on colour to say whether quorum is met", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    const stats = Array.from(container.querySelectorAll<HTMLElement>(".pk-stat-card")).map((card) => ({
      label: card.querySelector(".pk-stat-card__label")?.textContent?.trim(),
      value: card.querySelector(".pk-stat-card__value")?.textContent?.trim(),
      note: card.querySelector(".pk-stat-card__note")?.textContent?.trim(),
    }));
    expect(stats.map(({ label }) => label)).toEqual(["Proposer", "Type", "Reviews", "Decision"]);
    expect(stats[2]).toMatchObject({ value: "0 / 2 required", note: "Quorum not met" });
    // Stored vocabulary is capitalized in the text itself, not by a CSS
    // transform a screen reader never sees.
    expect(stats[1]?.value).toBe("Talk");
    expect(stats[3]?.value).toBe("Accepted");
  });
});
