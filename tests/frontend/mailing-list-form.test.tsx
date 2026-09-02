// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupMailingListCreateSchema } from "../../assets/shared/schemas/mailing-lists";
import { MEMBERSHIP_CATEGORIES, type MembershipCategory } from "../../assets/shared/schemas/membership-categories";
import { MailingListForm } from "../../assets/ts/components/mailing-lists/MailingListForm";
import { emptyMailingListDraft, mailingListDraftToPayload } from "../../assets/ts/components/mailing-lists/model";
import { controlFor, labelNames, typeInto } from "./helpers/labelled-control";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

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

    expect(controlFor<HTMLSelectElement>(container, "Posting policy").value).toBe("members");
    expect(controlFor<HTMLSelectElement>(container, "Moderation policy").value).toBe("moderated");

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

  it("names every control through a for/id pair rather than by position", () => {
    const container = mount(<MailingListForm draft={emptyMailingListDraft()} onChange={vi.fn()} />);

    // The names a screen reader reads out, in order, up to the category
    // checkboxes the picker contributes.
    const names = labelNames(container);
    expect(names.slice(0, 7)).toEqual([
      "Email",
      "Label",
      "Purpose",
      "Ownership",
      "Default subscription",
      "Posting policy",
      "Moderation policy",
    ]);
    expect(names.slice(-2)).toEqual(["Primary discussion", "Active"]);

    // Resolving through the pair fails exactly when the pair is broken.
    expect(controlFor(container, "Email").type).toBe("email");
    expect(controlFor<HTMLSelectElement>(container, "Purpose").tagName).toBe("SELECT");
    expect(controlFor(container, "Ownership").readOnly).toBe(true);
  });

  it("marks the blocking fields required and points the read-only field at its explanation", () => {
    const container = mount(<MailingListForm draft={emptyMailingListDraft()} onChange={vi.fn()} />);

    expect(controlFor(container, "Email").required).toBe(true);
    expect(controlFor(container, "Label").required).toBe(true);
    // Nothing is invalid until it has been checked, so no control claims to be.
    expect(container.querySelector("[aria-invalid]")).toBeNull();

    const ownership = controlFor(container, "Ownership");
    const describedBy = ownership.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`[id="${describedBy!}"]`)?.textContent).toBe(
      "Set by the group this list belongs to.",
    );
  });

  it("draws each choice control with all three check parts, not an operating-system default", () => {
    const container = mount(<MailingListForm draft={emptyMailingListDraft()} onChange={vi.fn()} />);

    const checks = [...container.querySelectorAll("label.pk-check")];
    // One per membership category the picker offers, then the form's own two
    // switches. Counting all of them keeps the picker inside the same
    // guarantee: a `pk-check` label with no `pk-check__input` renders the
    // operating system's own box, which no gate can see.
    expect(checks).toHaveLength(MEMBERSHIP_CATEGORIES.length + 2);
    for (const check of checks) {
      expect(check.querySelector("input.pk-check__input")).not.toBeNull();
      expect(check.querySelector("span.pk-check__label")?.textContent).toBeTruthy();
    }
    expect(checks.slice(0, MEMBERSHIP_CATEGORIES.length).map((check) => check.textContent)).toEqual([
      ...MEMBERSHIP_CATEGORIES,
    ]);
    expect(checks.slice(-2).map((check) => check.textContent)).toEqual(["Primary discussion", "Active"]);
  });

  it("reports an edit that still satisfies the shared create contract", async () => {
    const onChange = vi.fn();
    const draft = { ...emptyMailingListDraft(), label: "Architecture" };
    const container = mount(<MailingListForm draft={draft} onChange={onChange} />);

    await typeInto(controlFor(container, "Email"), "architecture@example.test");

    expect(onChange).toHaveBeenCalledWith({ email: "architecture@example.test" });
    const patch = onChange.mock.calls.at(-1)![0] as Partial<typeof draft>;
    expect(groupMailingListCreateSchema.parse(mailingListDraftToPayload({ ...draft, ...patch }))).toMatchObject({
      email: "architecture@example.test",
      label: "Architecture",
    });
  });

  it("rejects an edit that empties a required field", async () => {
    const onChange = vi.fn();
    const draft = { ...emptyMailingListDraft(), email: "architecture@example.test", label: "Architecture" };
    const container = mount(<MailingListForm draft={draft} onChange={onChange} />);

    await typeInto(controlFor(container, "Label"), "   ");

    const patch = onChange.mock.calls.at(-1)![0] as Partial<typeof draft>;
    const result = groupMailingListCreateSchema.safeParse(mailingListDraftToPayload({ ...draft, ...patch }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain("label");
  });
});
