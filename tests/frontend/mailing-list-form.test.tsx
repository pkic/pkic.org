// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupMailingListCreateSchema } from "../../assets/shared/schemas/mailing-lists";
import type { MembershipCategory } from "../../assets/shared/schemas/membership-categories";
import { MailingListForm } from "../../assets/ts/components/mailing-lists/MailingListForm";
import { emptyMailingListDraft, mailingListDraftToPayload } from "../../assets/ts/components/mailing-lists/model";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("shared mailing-list form model", () => {
  it("serializes the complete group contract without a user-editable owner", () => {
    const draft = {
      ...emptyMailingListDraft(),
      email: "  architecture@example.test ",
      label: " Architecture ",
      purpose: "consultation" as const,
      primaryDiscussion: true,
      subscriptionDefault: "eligible_categories" as const,
      postingPolicy: "members" as const,
      moderationPolicy: "moderated" as const,
      autoSyncCategories: ["A", "H1"] as MembershipCategory[],
      active: false,
    };

    expect(groupMailingListCreateSchema.parse(mailingListDraftToPayload(draft))).toEqual({
      email: "architecture@example.test",
      label: "Architecture",
      purpose: "consultation",
      primaryDiscussion: true,
      subscriptionDefault: "eligible_categories",
      postingPolicy: "members",
      moderationPolicy: "moderated",
      autoSyncCategories: ["A", "H1"],
      active: false,
    });
  });

  it("serializes group payloads without a user-editable group id", () => {
    const draft = {
      ...emptyMailingListDraft(),
      email: "group@example.test",
      label: "Group list",
      purpose: "group" as const,
    };

    const payload = mailingListDraftToPayload(draft);
    expect(payload).toMatchObject({
      email: "group@example.test",
      label: "Group list",
      purpose: "group",
    });
    expect(payload).not.toHaveProperty("groupId");
  });

  it("treats an empty category selection as every category, not an invalid value", () => {
    expect(mailingListDraftToPayload({ ...emptyMailingListDraft(), autoSyncCategories: [] }).autoSyncCategories).toBe(
      null,
    );
  });

  it("rejects categories outside the shared membership vocabulary", () => {
    expect(() =>
      mailingListDraftToPayload({
        ...emptyMailingListDraft(),
        autoSyncCategories: ["not-a-category"] as unknown as MembershipCategory[],
      }),
    ).toThrow();
  });

  it("renders one complete field set while deriving ownership in group context", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    const draft = {
      ...emptyMailingListDraft(),
      email: "group@example.test",
      label: "Group list",
      purpose: "group" as const,
      primaryDiscussion: true,
      subscriptionDefault: "group_members" as const,
      postingPolicy: "members" as const,
      moderationPolicy: "moderated" as const,
      autoSyncCategories: ["A"] as MembershipCategory[],
      active: true,
    };
    void act(() => render(<MailingListForm draft={draft} onChange={vi.fn()} idPrefix="mailing-list" />, container));

    expect(container.querySelector<HTMLInputElement>("input[readonly]")?.value).toBe("This group");
    expect(container.textContent).not.toContain("Group ID");
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    // purpose, subscription default, posting policy, moderation policy
    expect(container.querySelectorAll("select")).toHaveLength(4);
    expect(container.textContent).toContain("Posting policy");
    expect(container.textContent).toContain("Moderation policy");
    expect(container.textContent).toContain("Auto-sync categories");

    const postingPolicy = container.querySelector<HTMLSelectElement>("#mailing-list-posting-policy")!;
    expect(postingPolicy.value).toBe("members");
    const moderationPolicy = container.querySelector<HTMLSelectElement>("#mailing-list-moderation-policy")!;
    expect(moderationPolicy.value).toBe("moderated");

    const categoryA = container.querySelector<HTMLInputElement>("#mailing-list-auto-sync-categories-A")!;
    expect(categoryA.checked).toBe(true);
    const categoryB = container.querySelector<HTMLInputElement>("#mailing-list-auto-sync-categories-B")!;
    expect(categoryB.checked).toBe(false);
  });

  it("toggling a category checkbox notifies the caller with the updated selection", () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    const onChange = vi.fn();
    const draft = { ...emptyMailingListDraft(), autoSyncCategories: ["A"] as MembershipCategory[] };
    void act(() => render(<MailingListForm draft={draft} onChange={onChange} idPrefix="mailing-list" />, container));

    const categoryB = container.querySelector<HTMLInputElement>("#mailing-list-auto-sync-categories-B")!;
    categoryB.checked = true;
    void act(() => {
      categoryB.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({ autoSyncCategories: ["A", "B"] });
  });
});
