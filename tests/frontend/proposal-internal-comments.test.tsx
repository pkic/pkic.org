// @vitest-environment jsdom
/**
 * The proposal's internal discussion: the comment box and the thread under it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ProposalInternalCommentsPanel } from "../../assets/ts/components/proposals/ProposalInternalCommentsPanel";
import type { ProposalInternalComment } from "../../assets/shared/schemas/proposal-comments";
import { buttonNamed, labelNames, markdownControl } from "./helpers/labeled-control";

let container: HTMLElement | null = null;

afterEach(() => {
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
  it("gives the comment box a name and describes what happens to what is typed", async () => {
    const root = mount(commentsPanel());

    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Reviewer comments");
    expect(labelNames(root)).toEqual(["Add a comment"]);
    const box = await markdownControl(root, "Add a comment");
    expect(box.getAttribute("role")).toBe("textbox");
    // The empty state says who reads the comments; the field adds no second line saying it again.
    expect(box.getAttribute("aria-describedby") ?? "").toBe("");
    expect(root.querySelector("h4")?.textContent).toBe("Reviewer comments");
  });

  it("refuses to post a draft that is only whitespace", async () => {
    const onAddComment = vi.fn(async () => {});
    const root = mount(commentsPanel({ commentDraft: "   ", onAddComment }));

    const submit = buttonNamed(root, "Add comment");
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

    const submit = buttonNamed(root, "Add comment");
    expect(submit.disabled).toBe(false);
    await act(async () => {
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onAddComment).toHaveBeenCalledOnce();
  });

  it("names an empty discussion and offers more through a button when there is more", async () => {
    const empty = mount(commentsPanel({ comments: [], commentsPage: null }));
    // The comment editor may still be loading and announce that too; the empty thread is its own status.
    const statuses = [...empty.querySelectorAll('[role="status"]')].map((status) => status.textContent);
    expect(statuses.some((text) => text?.includes("No reviewer comments yet"))).toBe(true);

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
