// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { AuditLogTable } from "../../assets/ts/components/AuditLogTable";
import { EnumSelect } from "../../assets/ts/components/EnumSelect";
import { FilterSelect } from "../../assets/ts/components/FilterSelect";
import { FormActions } from "../../assets/ts/components/FormActions";
import { MembershipCategoryPicker } from "../../assets/ts/components/MembershipCategoryPicker";
import { TimeZoneSelect } from "../../assets/ts/components/TimeZoneSelect";
import { Field } from "../../assets/ts/ui/Field";
import { MEMBERSHIP_CATEGORIES, type MembershipCategory } from "../../assets/shared/schemas/membership-categories";
import { SeriesManagedNotice } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/SeriesManagedNotice";
import { SettingsEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/SettingsEditor";
import { Tabs } from "../../assets/ts/components/Tabs";
import { promoterRankCardClass, promoterRankTier } from "../../assets/ts/shared/donation/promoter-ranking";
import { useOffsetPager } from "../../assets/ts/hooks/useOffsetPager";
import { buttonNamed, controlFor, namedGroup } from "./helpers/labelled-control";
import { tabs } from "./helpers/tabs";

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
  vi.unstubAllGlobals();
});

describe("shared management presentation components", () => {
  it("uses the shared promoter ranking policy on both leaderboards", () => {
    expect([1, 2, 3, 4, 10, 11].map(promoterRankTier)).toEqual([
      "gold",
      "silver",
      "bronze",
      "top-ten",
      "top-ten",
      "other",
    ]);
    expect([1, 2, 3, 4, 10, 11].map(promoterRankCardClass)).toEqual([
      "top-1",
      "top-2",
      "top-3",
      "top-ten",
      "top-ten",
      "",
    ]);
  });

  it("keeps offset pagination behavior in one reusable controller", () => {
    let pager: ReturnType<typeof useOffsetPager> | undefined;
    function Harness() {
      pager = useOffsetPager(25);
      return null;
    }
    mount(<Harness />);
    void act(() => pager?.pagerProps({ hasMore: true, rowCount: 25, total: 60 }).onNext());
    expect(pager?.offset).toBe(25);
    void act(() => pager?.pagerProps({ hasMore: true, rowCount: 25, total: 60 }).onJump(3));
    expect(pager?.offset).toBe(50);
    void act(() => pager?.pagerProps({ hasMore: false, rowCount: 10, total: 60 }).onPageSizeChange(50));
    expect(pager?.offset).toBe(0);
    expect(pager?.pageSize).toBe(50);
  });

  it("renders filter options and reports the selected value", () => {
    const onChange = vi.fn();
    const container = mount(
      <FilterSelect
        label="Status"
        value="all"
        options={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
        ]}
        onChange={onChange}
      />,
    );
    // A visible label has to point at the control it names. The version this
    // replaces rendered a bare `<label>` with no `for` and put a second copy
    // of the same word in `aria-label`: two names, neither of them wired.
    const select = controlFor<HTMLSelectElement>(container, "Status");
    expect(select.tagName.toLowerCase()).toBe("select");
    expect(select.getAttribute("aria-label")).toBeNull();
    select.value = "active";
    void act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("active");
  });

  it("FilterSelect never leaves a select anonymous, however little the caller names it", () => {
    // A toolbar filter has no room for a visible label, and call sites exist
    // that pass neither name — which announced "combo box" and nothing more.
    const unnamed = mount(
      <FilterSelect value="" options={[{ value: "", label: "All statuses" }]} onChange={() => {}} />,
    );
    expect(unnamed.querySelector("select")?.getAttribute("aria-label")).toBe("Filter");

    const named = mount(
      <FilterSelect
        ariaLabel="Proposal status"
        value=""
        options={[{ value: "", label: "All statuses" }]}
        onChange={() => {}}
      />,
    );
    expect(named.querySelector("select")?.getAttribute("aria-label")).toBe("Proposal status");
    // No visible label, and therefore no orphaned `for` either.
    expect(named.querySelector("label")).toBeNull();
  });

  it("renders consistent busy and cancellation form actions", () => {
    const onCancel = vi.fn();
    const container = mount(
      <FormActions
        submitLabel="Save"
        busyLabel="Saving…"
        busy
        onCancel={onCancel}
        status="Waiting"
        submitVariant="primary"
      />,
    );
    const [submit, cancel] = [...container.querySelectorAll("button")];
    expect(submit.textContent).toBe("Saving…");
    expect(submit.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(container.textContent).toContain("Waiting");
  });

  it("says a save is in flight to assistive technology, not only by swapping the label", () => {
    const busy = mount(<FormActions submitLabel="Save" busyLabel="Saving…" busy onCancel={vi.fn()} />);
    const submit = busy.querySelector("button")!;
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(submit.getAttribute("aria-disabled")).toBe("true");

    const idle = mount(<FormActions submitLabel="Save" busy={false} onCancel={vi.fn()} />);
    const idleSubmit = idle.querySelector("button")!;
    expect(idleSubmit.hasAttribute("aria-busy")).toBe(false);
    expect(idleSubmit.disabled).toBe(false);
  });

  it("announces a failed save as an alert rather than colouring the same sentence red", () => {
    const failed = mount(
      <FormActions
        submitLabel="Save"
        busy={false}
        onCancel={vi.fn()}
        status="Could not save."
        statusVariant="danger"
      />,
    );
    const alert = failed.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Could not save.");

    // The routine outcome is not an alert: it is announced politely, so a
    // reader is not interrupted every time a form reports that it saved.
    const saved = mount(<FormActions submitLabel="Save" busy={false} onCancel={vi.fn()} status="Saved." />);
    expect(saved.querySelector('[role="alert"]')).toBeNull();
    expect(saved.querySelector('[role="status"]')?.textContent).toBe("Saved.");
  });

  it("keeps cancel reachable while the save is in flight only when the form is not busy", () => {
    const onCancel = vi.fn();
    const ready = mount(<FormActions submitLabel="Save" busy={false} onCancel={onCancel} />);
    void act(() => buttonNamed(ready, "Cancel").click());
    expect(onCancel).toHaveBeenCalledTimes(1);

    const busy = mount(<FormActions submitLabel="Save" busy onCancel={onCancel} />);
    void act(() => buttonNamed(busy, "Cancel").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders one settings shell for loading, errors, actions, and content", () => {
    const loading = mount(
      <SettingsEditor loading error={null} description="Settings" actions={<button>Save</button>}>
        Content
      </SettingsEditor>,
    );
    expect(loading.querySelector('[role="status"]')).not.toBeNull();

    const ready = mount(
      <SettingsEditor loading={false} error={null} description="Settings" actions={<button>Save</button>}>
        <span>Content</span>
      </SettingsEditor>,
    );
    expect(ready.textContent).toContain("Settings");
    expect(ready.textContent).toContain("Save");
    expect(ready.textContent).toContain("Content");

    // The wait is announced with a name, not mimed by a grey rectangle.
    expect(loading.querySelector('[role="status"]')?.textContent).toContain("Loading settings…");
  });

  it("replaces the settings shell with the reason it could not load", () => {
    const failed = mount(
      <SettingsEditor loading={false} error="HTTP 403" description="Settings" actions={<button>Save</button>}>
        <span>Content</span>
      </SettingsEditor>,
    );

    // The failure is announced where it appears, and nothing behind it invites
    // an edit that cannot be saved.
    expect(failed.querySelector('[role="alert"]')?.textContent).toContain("You don't have access to this");
    expect(failed.textContent).not.toContain("Content");
    expect(failed.textContent).not.toContain("HTTP 403");
  });

  it("sends a series-managed event to its series through a real link", () => {
    const container = mount(<SeriesManagedNotice event={{ ownerGroupId: "group-1", seriesId: "series-1" }} />);

    // An informational tone, so it is announced politely rather than
    // interrupting the reader the way role="alert" would.
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    const link = container.querySelector<HTMLAnchorElement>("a");
    // A link, not a button: it navigates, so it can be opened in a new tab.
    expect(link?.getAttribute("href")).toBe("#/groups/group-1/meetings/series-1");
    expect(link?.textContent).toContain("Open meeting series");
  });

  it("says why a series-managed event offers no way through when its group is unknown", () => {
    const container = mount(<SeriesManagedNotice event={{ ownerGroupId: null, seriesId: "series-1" }} />);

    // No dead control: the sentence explains the absence instead.
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("The owning group for this meeting series could not be determined.");
  });

  it("moves focus with the complete tabs keyboard pattern without requiring generated ids", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onChange = vi.fn();
    const container = mount(
      <Tabs
        items={[
          { key: "settings", label: "Settings" },
          { key: "occurrences", label: "Occurrences" },
          { key: "attendance", label: "Attendance" },
        ]}
        active="settings"
        onChange={onChange}
      />,
    );
    const rendered = tabs(container);
    rendered[0].focus();
    void act(() => {
      rendered[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("attendance");
    expect(document.activeElement).toBe(rendered[2]);
    void act(() => {
      rendered[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("settings");
    expect(document.activeElement).toBe(rendered[0]);
    void act(() => {
      rendered[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("attendance");
    expect(document.activeElement).toBe(rendered[2]);
  });

  it("renders shared audit columns while preserving domain-specific cells", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              auditLog: [
                {
                  id: "audit-1",
                  created_at: "2026-08-21T10:00:00.000Z",
                  actor_type: "system",
                  actor_id: null,
                  actor_display: null,
                  action: "updated",
                  entity_type: "proposal",
                  entity_id: "proposal-1",
                  details: { field: "title" },
                },
              ],
              page: { limit: 50, offset: 0, total: 1, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const container = mount(
      <AuditLogTable
        endpoint="/api/v1/proposals/proposal-1/audit-log"
        actionCell={(entry) => <strong>{entry.action}</strong>}
        detailsCell={() => <span>domain details</span>}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("System");
    expect(container.querySelector("strong")?.textContent).toBe("updated");
    expect(container.textContent).toContain("domain details");
  });

  it("EnumSelect renders human labels for machine values and reports the machine value on change", () => {
    const onChange = vi.fn();
    const container = mount(
      <Field label="Status">
        {(control) => (
          <EnumSelect
            {...control}
            value="draft"
            options={[
              { value: "draft", label: "Draft" },
              { value: "published", label: "Published" },
            ]}
            onChange={onChange}
          />
        )}
      </Field>,
    );
    // The control renders no label of its own: the Field around it names it,
    // and resolving through that label fails exactly when the pair is broken.
    const select = controlFor<HTMLSelectElement>(container, "Status");
    expect(select.options).toHaveLength(2);
    expect(select.options[1].textContent).toBe("Published");
    select.value = "published";
    void act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("published");
  });

  it("EnumSelect announces a required field in words, and survives a value outside its vocabulary", () => {
    const container = mount(
      <Field label="Posting policy" required help="Who may post to this list.">
        {(control) => (
          <EnumSelect
            {...control}
            value={"retired" as "members" | "subscribers"}
            options={[
              { value: "members", label: "Members" },
              { value: "subscribers", label: "Subscribers" },
            ]}
            onChange={() => {}}
          />
        )}
      </Field>,
    );

    const select = controlFor<HTMLSelectElement>(container, "Posting policy");
    // A value the contract no longer offers selects nothing rather than
    // inventing an option for itself, so a stale record cannot be silently
    // re-saved under a vocabulary term that does not exist.
    expect(select.value).toBe("");
    expect(select.required).toBe(true);

    // The asterisk is decorative; the word behind it is what gets announced,
    // so "required" survives even with images and colour off.
    const label = container.querySelector("label")!;
    expect(label.textContent).toContain("(required)");
    expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");

    // Help text is guidance, so it is described-by rather than part of the name.
    const helpId = select.getAttribute("aria-describedby");
    expect(container.querySelector(`[id="${helpId!}"]`)?.textContent).toBe("Who may post to this list.");
  });

  it("TimeZoneSelect keeps the submitted value as the raw IANA identifier typed or picked", () => {
    const onChange = vi.fn();
    const container = mount(
      <Field label="Time zone" required>
        {(control) => <TimeZoneSelect {...control} value="Europe/Amsterdam" onChange={onChange} />}
      </Field>,
    );
    const input = controlFor(container, "Time zone");
    expect(input.value).toBe("Europe/Amsterdam");
    expect(container.querySelector(`#${input.getAttribute("list")}`)).not.toBeNull();
    input.value = "America/New_York";
    void act(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("America/New_York");
  });

  it("TimeZoneSelect names its control, marks it required in words, and wires its guidance", () => {
    const container = mount(
      <Field label="Time zone" required help="Recurrence is expanded in this zone.">
        {(control) => <TimeZoneSelect {...control} value="Europe/Amsterdam" onChange={vi.fn()} />}
      </Field>,
    );

    // Resolved through the label's own for/id pair, so the lookup fails
    // exactly when the labelling contract does.
    const input = controlFor(container, "Time zone");
    expect(input.hasAttribute("required")).toBe(true);
    // The asterisk is decorative; the word behind it is what is announced.
    const marker = container.querySelector(".pk-field__required");
    expect(marker?.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
    expect(marker?.querySelector(".pk-field__sr")?.textContent).toBe("(required)");
    // The guidance is tied to the control rather than merely placed beside it.
    expect(container.querySelector(`#${input.getAttribute("aria-describedby")!}`)?.textContent).toBe(
      "Recurrence is expanded in this zone.",
    );
  });

  it("TimeZoneSelect leaves no orphaned required marker when the field is optional", () => {
    const container = mount(
      <Field label="Time zone">{(control) => <TimeZoneSelect {...control} value="" onChange={vi.fn()} />}</Field>,
    );

    expect(controlFor(container, "Time zone").hasAttribute("required")).toBe(false);
    expect(container.querySelector(".pk-field__required")).toBeNull();
    // No help means no dangling aria-describedby pointing at nothing.
    expect(controlFor(container, "Time zone").getAttribute("aria-describedby")).toBeNull();
  });

  it("MembershipCategoryPicker treats an empty selection as every category", () => {
    const onChange = vi.fn();
    const container = mount(
      <MembershipCategoryPicker idPrefix="sync" label="Auto-sync categories" selected={[]} onChange={onChange} />,
    );
    expect(container.textContent).toContain("Leave every box unchecked to include all membership categories.");
    for (const category of MEMBERSHIP_CATEGORIES) {
      expect(container.querySelector<HTMLInputElement>(`#sync-${category}`)?.checked).toBe(false);
    }

    const categoryG = container.querySelector<HTMLInputElement>("#sync-G")!;
    categoryG.checked = true;
    void act(() => {
      categoryG.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(["G"]);
  });

  it("MembershipCategoryPicker reports a newly checked category in canonical vocabulary order, not click order", () => {
    const onChange = vi.fn();
    const container = mount(
      <MembershipCategoryPicker idPrefix="sync" label="Auto-sync categories" selected={["G"]} onChange={onChange} />,
    );
    const categoryB = container.querySelector<HTMLInputElement>("#sync-B")!;
    expect(categoryB.checked).toBe(false);
    categoryB.checked = true;
    void act(() => {
      categoryB.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(["B", "G"]);
  });

  it("MembershipCategoryPicker unchecking the last selected category returns to the empty (all) selection", () => {
    const onChange = vi.fn();
    const selected: MembershipCategory[] = ["A"];
    const container = mount(
      <MembershipCategoryPicker idPrefix="sync" label="Auto-sync categories" selected={selected} onChange={onChange} />,
    );
    const categoryA = container.querySelector<HTMLInputElement>("#sync-A")!;
    expect(categoryA.checked).toBe(true);
    categoryA.checked = false;
    void act(() => {
      categoryA.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("MembershipCategoryPicker names the set with a legend and ties its guidance to the group", () => {
    const container = mount(
      <MembershipCategoryPicker idPrefix="sync" label="Auto-sync categories" selected={[]} onChange={vi.fn()} />,
    );

    // A row of fifteen single-letter boxes with no group name is announced as
    // fifteen unrelated checkboxes; the legend is what says what they are.
    const group = namedGroup(container, "Auto-sync categories");
    const describedBy = group.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`[id="${describedBy!}"]`)?.textContent).toBe(
      "Leave every box unchecked to include all membership categories.",
    );

    // Every box is a complete check block: `pk-check` on the label alone
    // renders the operating system's own control, which no gate can see.
    const checks = [...container.querySelectorAll<HTMLLabelElement>("label.pk-check")];
    expect(checks).toHaveLength(MEMBERSHIP_CATEGORIES.length);
    for (const check of checks) {
      const input = check.querySelector<HTMLInputElement>("input.pk-check__input");
      expect(input).not.toBeNull();
      expect(check.control).toBe(input);
      expect(check.querySelector("span.pk-check__label")?.textContent).toBeTruthy();
    }
  });

  it("MembershipCategoryPicker takes the whole set out of play through the fieldset, not per control", () => {
    const container = mount(
      <MembershipCategoryPicker
        idPrefix="sync"
        label="Auto-sync categories"
        selected={[]}
        onChange={vi.fn()}
        disabled
      />,
    );

    // `disabled` on the fieldset is the one attribute that takes every control
    // inside it out of play, including ones a parent cannot reach.
    expect(namedGroup(container, "Auto-sync categories").disabled).toBe(true);
    for (const category of MEMBERSHIP_CATEGORIES) {
      expect(container.querySelector<HTMLInputElement>(`#sync-${category}`)?.disabled).toBe(true);
    }
  });
});

/**
 * The shared components every list surface renders. Their internals now
 * delegate to the design system, so what is worth asserting here is what a
 * visual specimen cannot show: what each one exposes to assistive technology,
 * and what it does when the data or the request is not the happy one.
 */
