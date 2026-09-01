// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { ActivityChartCard } from "../../assets/ts/components/analytics/ActivityChartCard";
import { AuditLogTable } from "../../assets/ts/components/AuditLogTable";
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
    const select = container.querySelector("select") as HTMLSelectElement;
    select.value = "active";
    void act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("active");
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
    select.value = "published";
    void act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("published");
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
