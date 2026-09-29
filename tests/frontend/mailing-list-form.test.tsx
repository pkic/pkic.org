// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { exampleMembershipCategories } from "./helpers/membership-category-catalog";
vi.mock("../../assets/ts/hooks/useMembershipCategoryCatalog", () => ({
  useMembershipCategoryCatalog: () => exampleMembershipCategories,
}));
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
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

    /*
     * Ownership is stated, not offered: it used to be a text input carrying
     * `readOnly`, which reads as a field a reader may type in and cannot
     * (#50). The group it belongs to is a fact about the list.
     */
    expect(container.querySelector("input[readonly]")).toBeNull();
    expect(container.textContent).toContain("Owned by this group");
    expect(container.textContent).not.toContain("Group ID");
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    // purpose, subscription default, posting policy, moderation policy
    expect(container.querySelectorAll("select")).toHaveLength(4);
    expect(container.textContent).toContain("Posting policy");
    expect(container.textContent).toContain("Moderation policy");
    expect(container.textContent).toContain("Subscribe these membership categories automatically");

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
      categoryB.dispatchEvent(new Event("input", { bubbles: true }));
      categoryB.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({ autoSyncCategories: ["A", "B"] });
  });

  it("names every control through a for/id pair rather than by position", () => {
    const container = mount(<MailingListForm draft={emptyMailingListDraft()} onChange={vi.fn()} />);

    // The names a screen reader reads out, in order, up to the category
    // checkboxes the picker contributes.
    const names = labelNames(container);
    /*
     * In the order the reader meets them, grouped by the question each
     * answers (#50): what the list is, who is on it, what may be done on it.
     * Ownership is no longer among them — it is a fact the Audience section
     * states rather than a field wearing `readOnly`.
     */
    const sectionLabels = (title: string) => {
      const section = [...container.querySelectorAll("fieldset.pk-form-section")].find(
        (node) => node.querySelector("legend.pk-form-section__title")?.textContent === title,
      );
      // The required mark is part of the label's markup, so the words are
      // taken from the text node the reader reads rather than the whole.
      return [...(section?.querySelectorAll("label.pk-field__label") ?? [])].map((label) =>
        label.firstChild?.textContent?.trim(),
      );
    };

    expect(sectionLabels("Identity")).toEqual(["Email", "Label"]);
    expect(sectionLabels("Audience")).toEqual(["Purpose", "Default subscription"]);
    expect(sectionLabels("Policy")).toEqual(["Posting policy", "Moderation policy"]);
    // Every named control still belongs to one of the groups.
    expect(names).toContain("Email");
    expect(names).toContain("Moderation policy");

    // Resolving through the pair fails exactly when the pair is broken.
    expect(controlFor(container, "Email").type).toBe("email");
    expect(controlFor<HTMLSelectElement>(container, "Purpose").tagName).toBe("SELECT");
  });

  it("marks the blocking fields required and groups the rest under what they decide", () => {
    const container = mount(<MailingListForm draft={emptyMailingListDraft()} onChange={vi.fn()} />);

    expect(controlFor(container, "Email").required).toBe(true);
    expect(controlFor(container, "Label").required).toBe(true);
    // Nothing is invalid until it has been checked, so no control claims to be.
    expect(container.querySelector("[aria-invalid]")).toBeNull();

    /*
     * #50: seven fields in one undifferentiated grid put the address, the
     * label, the purpose, the ownership, the default subscription and two
     * policies in a single row on a wide screen, with nothing saying which
     * belonged with which. Each group states the question it answers.
     */
    const sections = [...container.querySelectorAll("legend.pk-form-section__title")].map(
      (legend) => legend.textContent,
    );
    expect(sections).toEqual(["Identity", "Audience", "Policy", "Standing"]);
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
    /*
     * The categories are named, not coded. A row of thirteen bare letters is
     * not a choice a reader can weigh — the same complaint #53 made about the
     * organization form's category select. The catalogue that carries the
     * words is fetched, so with none loaded each keeps its code rather than
     * rendering blank.
     */
    expect(checks.slice(0, MEMBERSHIP_CATEGORIES.length).map((check) => check.textContent)).toEqual([
      ...exampleMembershipCategories.map(({ code, label }) => `${label} (${code})`),
    ]);
    expect(checks.slice(-2).map((check) => check.querySelector(".pk-check__label")?.textContent)).toEqual([
      "List enabled",
      "The group's primary discussion list",
    ]);
    const enabled = checks.at(-2)!.querySelector("input")!;
    expect(document.getElementById(enabled.getAttribute("aria-labelledby")!)?.textContent).toBe("List enabled");
    expect(document.getElementById(enabled.getAttribute("aria-describedby")!)?.textContent).toContain(
      "queues removal of managed subscribers",
    );
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
