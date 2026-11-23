// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  organizationMemberProfileSchema,
  organizationContentReviewCreateSchema,
} from "../../assets/shared/schemas/organization-self-service";
import { ContentEditorCard } from "../../assets/ts/member-flows/portal/sections/MyOrganizationContentEditor";
import {
  organizationId,
  organizationProfile,
  pendingReview,
  rejectedReview,
} from "./helpers/organization-self-service";
import { beginRecordEdit } from "./helpers/record-edit";
import { controlFor as labeledControl } from "./helpers/labeled-control";
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
describe("organization content revisions", () => {
  it("revises a refused submission from what was proposed and shows the reviewer's note", async () => {
    const submissions: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        const body = JSON.parse(init.body);
        submissions.push(body);
        return new Response(
          JSON.stringify({
            review: { ...pendingReview(), proposedChanges: body },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    void act(() =>
      render(
        <ContentEditorCard
          organizationId={organizationId}
          org={organizationMemberProfileSchema.parse(organizationProfile({ rejectedReview: rejectedReview() }))}
          reload={async () => {}}
        />,
        container,
      ),
    );
    await settle();
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).not.toContain("Please drop the superlatives.");
    await beginRecordEdit(container, "Member page content actions", "Revise submission");
    await settle();
    expect((labeledControl(container, "Slogan") as HTMLInputElement).value).toBe("Rejected slogan");
    expect((labeledControl(container, "Blog URL") as HTMLInputElement).value).toBe("https://blog.example.test");
    expect(container.querySelector("form")?.textContent).toContain("Please drop the superlatives.");

    const slogan = labeledControl(container, "Slogan") as HTMLInputElement;
    slogan.value = "Revised slogan";
    await act(() => {
      slogan.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      slogan.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    // The revision is measured against the live profile, so the carried-over fields are sent again.
    expect(organizationContentReviewCreateSchema.parse(submissions[0])).toEqual({
      slogan: "Revised slogan",
      blogUrl: "https://blog.example.test",
      links: ["https://x.example.test"],
      adviceAcknowledged: false,
    });
  });
  it("starts ordinary edits from current staff-corrected content despite an older rejection", async () => {
    const submissions: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        const body = organizationContentReviewCreateSchema.parse(JSON.parse(init.body));
        submissions.push(body);
        return new Response(
          JSON.stringify({
            review: { ...pendingReview(), proposedChanges: body },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );
    const rejected = rejectedReview();
    rejected.proposedChanges.slogan = "Outdated rejected slogan";
    const org = organizationMemberProfileSchema.parse(
      organizationProfile({
        slogan: "Staff-corrected slogan",
        blogUrl: "https://current.example.test",
        links: ["https://current.example.test/profile"],
        rejectedReview: rejected,
      }),
    );
    void act(() =>
      render(<ContentEditorCard organizationId={organizationId} org={org} reload={async () => {}} />, container),
    );
    await beginRecordEdit(container, "Member page content actions", "Revise submission");
    expect((labeledControl(container, "Slogan") as HTMLInputElement).value).toBe("Outdated rejected slogan");
    const cancel = [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    await act(() => cancel!.click());
    await beginRecordEdit(container, "Member page content actions");
    expect((labeledControl(container, "Slogan") as HTMLInputElement).value).toBe("Staff-corrected slogan");
    expect(container.querySelector("form")?.textContent).not.toContain(rejected.reviewerNote);
    const blog = labeledControl(container, "Blog URL") as HTMLInputElement;
    expect(blog.value).toBe("https://current.example.test");
    blog.value = "https://new.example.test/blog";
    await act(() => {
      blog.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      blog.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(submissions).toEqual([{ blogUrl: "https://new.example.test/blog", adviceAcknowledged: false }]);
  });

  it("sends advised text as written only until the author edits it", async () => {
    const submissions: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        const body = JSON.parse(init.body);
        submissions.push(body);
        if (!body.adviceAcknowledged)
          return new Response(
            JSON.stringify({
              error: {
                code: "PROFILE_CHECK_ADVICE",
                message: "Review the feedback on your page.",
                details: { formErrors: [], fieldErrors: { slogan: ["Too promotional."] } },
              },
            }),
            { status: 422, headers: { "content-type": "application/json" } },
          );
        return new Response(JSON.stringify({ review: pendingReview() }), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    void act(() =>
      render(
        <ContentEditorCard
          organizationId={organizationId}
          org={organizationMemberProfileSchema.parse(organizationProfile())}
          reload={async () => {}}
        />,
        container,
      ),
    );
    await beginRecordEdit(container, "Member page content actions");
    const slogan = labeledControl(container, "Slogan") as HTMLInputElement;
    const submit = async () => {
      await act(async () => {
        slogan.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await settle();
    };
    const type = async (value: string) => {
      slogan.value = value;
      await act(() => {
        slogan.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("The best provider");
    await submit();
    expect(submissions[0]).toMatchObject({ adviceAcknowledged: false });
    // Editing the advised text asks again; submitting the same text again sends it as written.
    await type("A provider of certificates");
    await submit();
    expect(submissions[1]).toMatchObject({ slogan: "A provider of certificates", adviceAcknowledged: false });
    await submit();
    expect(submissions[2]).toMatchObject({ slogan: "A provider of certificates", adviceAcknowledged: true });
  });
});
