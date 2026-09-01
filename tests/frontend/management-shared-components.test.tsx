// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { ActivityChartCard } from "../../assets/ts/components/analytics/ActivityChartCard";
import { AuditLogTable } from "../../assets/ts/components/AuditLogTable";
import { Markdown } from "../../assets/ts/components/Markdown";
import { PersonCell } from "../../assets/ts/components/PersonCell";
import { StatCard } from "../../assets/ts/components/StatCard";
import { EnumSelect } from "../../assets/ts/components/EnumSelect";
import { FilterSelect } from "../../assets/ts/components/FilterSelect";
import { EventScheduleFields } from "../../assets/ts/components/EventScheduleFields";
import { FormActions } from "../../assets/ts/components/FormActions";
import { MembershipCategoryPicker } from "../../assets/ts/components/MembershipCategoryPicker";
import { TimeZoneSelect } from "../../assets/ts/components/TimeZoneSelect";
import { MEMBERSHIP_CATEGORIES, type MembershipCategory } from "../../assets/shared/schemas/membership-categories";
import { SettingsEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/SettingsEditor";
import { Tabs } from "../../assets/ts/components/Tabs";
import { promoterRankCardClass, promoterRankTier } from "../../assets/ts/shared/donation/promoter-ranking";
import { useOffsetPager } from "../../assets/ts/hooks/useOffsetPager";
import { buttonNamed, controlFor } from "./helpers/labelled-control";
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

  it("renders activity chart markup in the common card", () => {
    const container = mount(<ActivityChartCard chart={'<svg data-chart="activity"></svg>'} />);
    expect(container.textContent).toContain("Activity — last 30 days");
    expect(container.querySelector('[data-chart="activity"]')).not.toBeNull();
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

  it("reports every event schedule field through the shared editor", () => {
    const onStartsAtChange = vi.fn();
    const onEndsAtChange = vi.fn();
    const onTimezoneChange = vi.fn();
    const container = mount(
      <EventScheduleFields
        startsAt="2026-09-01T09:00"
        endsAt="2026-09-01T17:00"
        timezone="Europe/Amsterdam"
        onStartsAtChange={onStartsAtChange}
        onEndsAtChange={onEndsAtChange}
        onTimezoneChange={onTimezoneChange}
      />,
    );
    const inputs = [...container.querySelectorAll("input")];
    for (const [input, value] of inputs.map(
      (input, index) => [input, ["2026-10-01T10:00", "2026-10-01T18:00", "UTC"][index]] as const,
    )) {
      input.value = value;
      void act(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(onStartsAtChange).toHaveBeenCalledWith("2026-10-01T10:00");
    expect(onEndsAtChange).toHaveBeenCalledWith("2026-10-01T18:00");
    expect(onTimezoneChange).toHaveBeenCalledWith("UTC");
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
      <EnumSelect
        id="widget-status"
        label="Status"
        value="draft"
        options={[
          { value: "draft", label: "Draft" },
          { value: "published", label: "Published" },
        ]}
        onChange={onChange}
      />,
    );
    const select = container.querySelector<HTMLSelectElement>("#widget-status")!;
    expect(select.options).toHaveLength(2);
    expect(select.options[1].textContent).toBe("Published");
    // The caller owns the id, so the label it writes has to reach that id and
    // not a generated one.
    expect(controlFor<HTMLSelectElement>(container, "Status")).toBe(select);
    select.value = "published";
    void act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("published");
  });

  it("EnumSelect announces a required field in words, and survives a value outside its vocabulary", () => {
    const container = mount(
      <EnumSelect
        id="widget-policy"
        label="Posting policy"
        value={"retired" as "members" | "subscribers"}
        required
        help="Who may post to this list."
        options={[
          { value: "members", label: "Members" },
          { value: "subscribers", label: "Subscribers" },
        ]}
        onChange={() => {}}
      />,
    );

    const select = container.querySelector<HTMLSelectElement>("#widget-policy")!;
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
    expect(helpId).toBe("widget-policy-help");
    expect(container.querySelector(`[id="${helpId!}"]`)?.textContent).toBe("Who may post to this list.");
  });

  it("TimeZoneSelect keeps the submitted value as the raw IANA identifier typed or picked", () => {
    const onChange = vi.fn();
    const container = mount(
      <TimeZoneSelect id="series-timezone" label="Time zone" value="Europe/Amsterdam" onChange={onChange} />,
    );
    const input = container.querySelector<HTMLInputElement>("#series-timezone")!;
    expect(input.value).toBe("Europe/Amsterdam");
    expect(container.querySelector(`#${input.getAttribute("list")}`)).not.toBeNull();
    input.value = "America/New_York";
    void act(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("America/New_York");
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
});

/**
 * The shared components every list surface renders. Their internals now
 * delegate to the design system, so what is worth asserting here is what a
 * visual specimen cannot show: what each one exposes to assistive technology,
 * and what it does when the data or the request is not the happy one.
 */
describe("shared component translation layer", () => {
  it("PersonCell falls back to a placeholder name and omits the second line when nothing is on file", () => {
    const container = mount(<PersonCell firstName={null} lastName={null} email={null} />);
    expect(container.textContent).toContain("—");
    // The face repeats what the name says, so it is decoration rather than a
    // second announcement of the same person.
    expect(container.querySelector(".pk-avatar")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".pk-person-cell__email")).toBeNull();
  });

  it("PersonCell keeps the email as the quiet second line unless it is already the name", () => {
    const named = mount(<PersonCell firstName="Ada" lastName="Lovelace" email="ada@example.test" />);
    expect(named.querySelector(".pk-person-cell__name")?.textContent).toBe("Ada Lovelace");
    expect(named.querySelector(".pk-person-cell__email")?.textContent).toBe("ada@example.test");

    const unnamed = mount(<PersonCell firstName={null} lastName={null} email="ada@example.test" />);
    expect(unnamed.querySelector(".pk-person-cell__name")?.textContent).toBe("ada@example.test");
    expect(unnamed.querySelector(".pk-person-cell__email")).toBeNull();
  });

  it("StatCard states a bad figure in words rather than only tinting it", () => {
    const container = mount(<StatCard label="Failed Emails" value={3} note="1 bounced" variant="danger" />);
    expect(container.querySelector(".pk-stat-card__value")?.textContent).toBe("3");
    // The tint the Bootstrap version used is invisible to a reader who cannot
    // separate the hues, so the state is said instead.
    expect(container.querySelector(".pk-stat-card__note")?.textContent).toBe("Needs attention · 1 bounced");
  });

  it("StatCard leaves an ordinary figure unannotated and names its link with just the label", () => {
    const plain = mount(<StatCard label="Queued Emails" value={0} />);
    expect(plain.querySelector(".pk-stat-card__note")).toBeNull();

    const linked = mount(
      <StatCard label="Total Registrations" value={412} note="8 confirmed" href="#/registrations" />,
    );
    const link = linked.querySelector<HTMLAnchorElement>("a");
    // The whole card is the target, but the link's name stays "Total
    // Registrations" rather than the card's entire contents read aloud.
    expect(link?.textContent).toBe("Total Registrations");
    expect(link?.getAttribute("href")).toBe("#/registrations");
  });

  it("Markdown refuses an unsafe link target and keeps the text", () => {
    const container = mount(<Markdown markdown="[click me](javascript:alert(1))" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("Markdown names a video embed and renders a plain link as a link", () => {
    const embed = mount(<Markdown markdown="https://youtu.be/abc123" />);
    const frame = embed.querySelector<HTMLIFrameElement>("iframe");
    // An unnamed frame is announced as "frame", which says nothing about what
    // is inside it.
    expect(frame?.getAttribute("title")).toBe("Embedded video");
    expect(frame?.getAttribute("src")).toBe("https://www.youtube.com/embed/abc123");

    const linked = mount(<Markdown markdown="See [the policy](https://example.test/policy)." />);
    expect(linked.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("AuditLogTable names its table and says which history it is showing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ auditLog: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const container = mount(
      <AuditLogTable
        endpoint="/api/v1/groups/group-1/audit-log"
        caption="Group history"
        actionCell={(entry) => entry.action}
        detailsCell={() => null}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Four unnamed tables on a page are announced as four tables.
    expect(container.querySelector("caption")?.textContent).toBe("Group history");
    expect(container.textContent).toContain("No audit log entries.");
  });

  it("AuditLogTable states a failed history request as a sentence, not a status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const container = mount(
      <AuditLogTable
        endpoint="/api/v1/groups/group-1/audit-log"
        actionCell={(entry) => entry.action}
        detailsCell={() => null}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Something went wrong on our side.");
    expect(container.querySelector("table")).toBeNull();
  });
});
