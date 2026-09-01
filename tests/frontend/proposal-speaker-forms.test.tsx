// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { SpeakerFormCard } from "../../assets/ts/components/SpeakerFormCard";
import type { ProfileLinksHandle } from "../../assets/ts/components/ProfileLinksInput";
import { ProposalSpeakersPanel } from "../../assets/ts/components/proposals/ProposalSpeakersPanel";
import { ProposalInternalCommentsPanel } from "../../assets/ts/components/proposals/ProposalInternalCommentsPanel";
import { proposalSpeakerEndpoints } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/SpeakerCard";
import { applyFieldErrors } from "../../assets/ts/shared/form/validation-map";
import {
  proposalSpeakersResponseSchema,
  type ProposalSpeaker,
  type ProposalSpeakersResponse,
} from "../../assets/shared/schemas/proposal-speakers";
import type { ProposalInternalComment } from "../../assets/shared/schemas/proposal-comments";
import { buttonNamed, controlFor, groupNames, labelNames } from "./helpers/labelled-control";

let container: HTMLElement | null = null;

afterEach(() => {
  vi.unstubAllGlobals();
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ── SpeakerFormCard ──────────────────────────────────────────────────────────

function speakerCard(overrides: Partial<Parameters<typeof SpeakerFormCard>[0]> = {}) {
  return (
    <form>
      <SpeakerFormCard
        title="Speaker 1"
        idPrefix="spk-1"
        fields={{
          firstName: "speaker.1.firstName",
          lastName: "speaker.1.lastName",
          email: "speaker.1.email",
          organizationName: "speaker.1.organizationName",
          jobTitle: "speaker.1.jobTitle",
          bio: "speaker.1.bio",
          role: "speaker.1.role",
        }}
        linksFieldName="speaker.1.links"
        linksRef={createRef<ProfileLinksHandle>()}
        emailHelp="This person receives a personal confirmation link."
        bioHelp="A short professional biography."
        errorPaths={{
          firstName: "speakers.1.firstName",
          lastName: "speakers.1.lastName",
          email: "speakers.1.email",
          bio: "speakers.1.bio",
        }}
        {...overrides}
      />
    </form>
  );
}

describe("SpeakerFormCard", () => {
  it("names every control through its own for/id pair and every group by a legend", () => {
    const root = mount(speakerCard());
    const form = root.querySelector("form")!;

    expect(labelNames(form)).toEqual([
      "First name",
      "Last name",
      "Email",
      "Organization (optional)",
      "Job title (optional)",
      "Bio",
      "Proposer",
      "Speaker",
      "Co-speaker",
      "Moderator",
      "Panelist",
    ]);
    // Resolved through the pair itself, so the lookup fails exactly when the
    // accessibility contract is broken rather than when the markup is restyled.
    expect(controlFor(form, "First name").getAttribute("name")).toBe("speaker.1.firstName");
    expect(controlFor<HTMLTextAreaElement>(form, "Bio").tagName.toLowerCase()).toBe("textarea");
    expect(controlFor(form, "Email").type).toBe("email");
    // The visible "Role" and "Profile links" text used to be <label>s pointing
    // at no control at all; they are group names now, which is what a reader
    // hears on entering the group.
    expect(groupNames(form)).toEqual(["Role", "Profile links (optional)"]);
  });

  it("names the card as a region so one speaker can be told from the next", () => {
    const root = mount(speakerCard({ title: "You — as a speaker", idPrefix: "pspk" }));

    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("You — as a speaker");
    expect(root.querySelector("h4")?.textContent).toBe("You — as a speaker");
  });

  it("points each control at its help and error text before either says anything", () => {
    const root = mount(speakerCard());
    const form = root.querySelector("form")!;

    const email = controlFor(form, "Email");
    const describedBy = (email.getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy).toHaveLength(2);
    expect(form.querySelector(`#${describedBy[0]}`)?.textContent).toBe(
      "This person receives a personal confirmation link.",
    );
    // The error slot is empty at first paint and filled imperatively, so it has
    // to be a live region or the message is written where nobody is listening.
    const slot = form.querySelector(`#${describedBy[1]}`)!;
    expect(slot.getAttribute("aria-live")).toBe("polite");
    expect(slot.getAttribute("data-field-error")).toBe("speakers.1.email");
  });

  it("routes a rejected field to the slot its own control describes", () => {
    const root = mount(speakerCard());
    const form = root.querySelector("form")!;

    applyFieldErrors(form, {
      "speakers.1.email": "Enter a work email address.",
      "speakers.1.bio": "A biography needs at least 40 characters.",
    });

    const email = controlFor(form, "Email");
    const errorId = (email.getAttribute("aria-describedby") ?? "").split(" ")[1];
    expect(form.querySelector(`#${errorId}`)?.textContent).toBe("Enter a work email address.");
    expect(form.querySelector('[data-field-error="speakers.1.bio"]')?.textContent).toBe(
      "A biography needs at least 40 characters.",
    );
    // A field with no error keeps an empty slot rather than borrowing another's.
    expect(form.querySelector('[data-field-error="speakers.1.firstName"]')?.textContent).toBe("");
  });

  it("draws each role as a real radio rather than an operating-system default", () => {
    const root = mount(speakerCard({ defaultRole: "moderator" }));
    const form = root.querySelector("form")!;

    const moderator = form.querySelector<HTMLInputElement>('input[name="speaker.1.role"][value="moderator"]')!;
    expect(moderator.checked).toBe(true);
    // All three parts of the choice control, because one alone renders the
    // platform's own checkbox and nothing else complains.
    expect(moderator.className).toContain("pk-check__input");
    const label = moderator.closest("label")!;
    expect(label.className).toContain("pk-check");
    expect(label.htmlFor).toBe("role-spk-1-moderator");
    expect(label.querySelector(".pk-check__label")?.textContent).toBe("Moderator");
  });

  it("offers removal as a button, and offers none when the card cannot be removed", () => {
    const onRemove = vi.fn();
    const root = mount(speakerCard({ onRemove }));

    const remove = buttonNamed(root, "Remove");
    expect(remove.type).toBe("button");
    void act(() => remove.click());
    expect(onRemove).toHaveBeenCalledOnce();

    void act(() => render(null, container!));
    const fixed = mount(speakerCard());
    expect(() => buttonNamed(fixed, "Remove")).toThrow();
  });

  it("omits the role group entirely when the caller collects no role", () => {
    const root = mount(
      speakerCard({
        fields: {
          firstName: "proposerSpeakerFirstName",
          lastName: "proposerSpeakerLastName",
          email: "proposerSpeakerEmail",
          organizationName: "proposerSpeakerOrg",
          jobTitle: "proposerSpeakerTitle",
          bio: "proposerBio",
        },
      }),
    );

    expect(groupNames(root.querySelector("form")!)).toEqual(["Profile links (optional)"]);
    expect(root.querySelector('input[type="radio"]')).toBeNull();
  });
});

// ── ProposalSpeakersPanel ────────────────────────────────────────────────────

function rosterSpeaker(overrides: Partial<ProposalSpeaker> = {}): ProposalSpeaker {
  return {
    userId: "30000000-0000-4000-8000-000000000001",
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

function roster(speakers: ProposalSpeaker[]): ProposalSpeakersResponse {
  // Built through the canonical transport contract rather than cast, so the
  // fixture cannot drift away from what the endpoint actually returns.
  return proposalSpeakersResponseSchema.parse({
    proposal: {
      id: "10000000-0000-4000-8000-000000000001",
      title: "Post-quantum migration",
      status: "submitted",
      presentationDeadline: null,
      presentationUploaded: false,
      presentationUploadedAt: null,
    },
    summary: {
      total: speakers.length,
      confirmed: speakers.length,
      pending: 0,
      declined: 0,
      profileComplete: 0,
      presentationUploaded: 0,
    },
    speakers,
  });
}

function speakersPanel(overrides: Partial<Parameters<typeof ProposalSpeakersPanel>[0]> = {}) {
  return (
    <ProposalSpeakersPanel
      endpoint="/api/v1/proposals/proposal-1"
      proposalId="proposal-1"
      access={{ canReview: true, canFinalize: false }}
      proposal={{ proposer_user_id: "proposer-1", status: "submitted", proposal_type: "talk" }}
      endpoints={proposalSpeakerEndpoints()}
      {...overrides}
    />
  );
}

describe("ProposalSpeakersPanel", () => {
  it("states a refused roster load instead of rendering an empty roster", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "FORBIDDEN", message: "Speaker access requires proposal read permission" } },
          {
            status: 403,
          },
        ),
      ),
    );

    const root = mount(speakersPanel());
    await settle();

    expect(root.textContent).toContain("Speaker access requires proposal read permission");
    // A failure must not be mistaken for "nobody is assigned yet".
    expect(root.textContent).not.toContain("No speakers assigned yet");
  });

  it("names the region and says an empty roster in words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(roster([]))),
    );

    const root = mount(speakersPanel());
    await settle();

    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Proposal speakers");
    const status = root.querySelector('[role="status"]');
    expect(status?.textContent).toContain("No speakers assigned yet");
    expect(root.textContent).toContain("0 assigned");
  });

  it("reloads the roster from a real button rather than a clickable heading", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return Response.json(roster([rosterSpeaker()]));
      }),
    );

    const root = mount(speakersPanel());
    await settle();
    expect(urls).toEqual(["/api/v1/proposals/proposal-1/speakers"]);
    expect(root.textContent).toContain("1 assigned");

    const refresh = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("Refresh"))!;
    expect(refresh.tagName.toLowerCase()).toBe("button");
    await act(() => refresh.click());
    await settle();
    expect(urls).toHaveLength(2);
  });
});

// ── ProposalInternalCommentsPanel ────────────────────────────────────────────

function comment(overrides: Partial<ProposalInternalComment> = {}): ProposalInternalComment {
  return {
    id: "comment-1",
    proposal_id: "proposal-1",
    author_user_id: "reviewer-1",
    comment: "Worth a second reviewer.",
    created_at: "2026-08-02T09:00:00.000Z",
    updated_at: "2026-08-02T09:00:00.000Z",
    author_email: "reviewer@example.test",
    author_first_name: "Review",
    author_last_name: "Owner",
    ...overrides,
  };
}

function commentsPanel(overrides: Partial<Parameters<typeof ProposalInternalCommentsPanel>[0]> = {}) {
  return (
    <ProposalInternalCommentsPanel
      commentDraft=""
      savingComment={false}
      comments={[comment()]}
      commentsPage={{ limit: 25, offset: 0, total: 1, hasMore: false }}
      loadingMoreComments={false}
      onCommentDraftChange={() => {}}
      onAddComment={async () => {}}
      onLoadMoreComments={async () => {}}
      {...overrides}
    />
  );
}

describe("ProposalInternalCommentsPanel", () => {
  it("gives the comment box a name and describes what happens to what is typed", () => {
    const root = mount(commentsPanel());

    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Internal comments");
    expect(labelNames(root)).toEqual(["Add a comment"]);
    const box = controlFor<HTMLTextAreaElement>(root, "Add a comment");
    expect(box.tagName.toLowerCase()).toBe("textarea");
    const describedBy = box.getAttribute("aria-describedby")!;
    expect(root.querySelector(`#${describedBy}`)?.textContent).toContain("Markdown supported");
  });

  it("refuses to post a draft that is only whitespace", async () => {
    const onAddComment = vi.fn(async () => {});
    const root = mount(commentsPanel({ commentDraft: "   ", onAddComment }));

    const submit = buttonNamed(root, "Add Comment");
    expect(submit.disabled).toBe(true);
    await act(() => submit.click());
    expect(onAddComment).not.toHaveBeenCalled();
  });

  it("holds off a second write while the first is still in flight", async () => {
    const onAddComment = vi.fn(async () => {});
    const root = mount(commentsPanel({ commentDraft: "Needs a second reviewer.", savingComment: true, onAddComment }));

    const submit = buttonNamed(root, "Adding…");
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    await act(() => submit.click());
    expect(onAddComment).not.toHaveBeenCalled();
  });

  it("posts a usable draft once", async () => {
    const onAddComment = vi.fn(async () => {});
    const root = mount(commentsPanel({ commentDraft: "Needs a second reviewer.", onAddComment }));

    const submit = buttonNamed(root, "Add Comment");
    expect(submit.disabled).toBe(false);
    await act(async () => {
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onAddComment).toHaveBeenCalledOnce();
  });

  it("names an empty discussion and offers more through a button when there is more", async () => {
    const empty = mount(commentsPanel({ comments: [], commentsPage: null }));
    expect(empty.querySelector('[role="status"]')?.textContent).toContain("No internal comments yet");

    void act(() => render(null, container!));
    const onLoadMoreComments = vi.fn(async () => {});
    const more = mount(
      commentsPanel({
        commentsPage: { limit: 25, offset: 0, total: 30, hasMore: true },
        onLoadMoreComments,
      }),
    );
    const button = buttonNamed(more, "Load more comments");
    await act(() => button.click());
    expect(onLoadMoreComments).toHaveBeenCalledOnce();
  });
});
