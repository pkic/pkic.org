// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("serializes the complete global contract and preserves group ownership", () => {
    const draft = {
      ...emptyMailingListDraft(),
      email: "  architecture@example.test ",
      label: " Architecture ",
      purpose: "consultation" as const,
      groupId: "10000000-0000-4000-8000-000000000001",
      primaryDiscussion: true,
      subscriptionDefault: "eligible_categories" as const,
      postingPolicy: "members",
      moderationPolicy: "moderated",
      autoSyncCategories: "A, H1",
      active: false,
    };

    expect(mailingListDraftToPayload(draft, "admin")).toEqual({
      email: "architecture@example.test",
      label: "Architecture",
      purpose: "consultation",
      groupId: "10000000-0000-4000-8000-000000000001",
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
      groupId: "attacker-selected-group-id",
    };

    const payload = mailingListDraftToPayload(draft, "group");
    expect(payload).toMatchObject({
      email: "group@example.test",
      label: "Group list",
      purpose: "group",
    });
    expect(payload).not.toHaveProperty("groupId");
  });

  it("rejects categories outside the shared membership vocabulary", () => {
    expect(() =>
      mailingListDraftToPayload({ ...emptyMailingListDraft(), autoSyncCategories: "not-a-category" }, "group"),
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
      postingPolicy: "members",
      moderationPolicy: "moderated",
      autoSyncCategories: "A",
      active: true,
    };
    void act(() =>
      render(
        <MailingListForm
          draft={draft}
          onChange={vi.fn()}
          showGroupOwnership={false}
          ownershipLabel="Architecture group"
        />,
        container,
      ),
    );

    expect(container.querySelector<HTMLInputElement>("input[readonly]")?.value).toBe("Architecture group");
    expect(container.textContent).not.toContain("Group ID");
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelectorAll("select")).toHaveLength(2);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(container.textContent).toContain("Posting policy");
    expect(container.textContent).toContain("Moderation policy");
    expect(container.textContent).toContain("Auto-sync categories");
  });
});
