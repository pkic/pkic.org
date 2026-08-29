// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { ActivityChartCard } from "../../assets/ts/components/analytics/ActivityChartCard";
import { AuditLogTable } from "../../assets/ts/components/AuditLogTable";
import { FilterSelect } from "../../assets/ts/components/FilterSelect";
import { EventScheduleFields } from "../../assets/ts/components/EventScheduleFields";
import { FormActions } from "../../assets/ts/components/FormActions";
import { RegistrationActionCard } from "../../assets/ts/member-flows/portal/sections/events/detail/registration-detail/RegistrationActionCard";
import { SettingsEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/SettingsEditor";
import { Tabs } from "../../assets/ts/components/Tabs";
import { promoterRankCardClass, promoterRankTier } from "../../assets/ts/shared/donation/promoter-ranking";
import { useOffsetPager } from "../../assets/ts/hooks/useOffsetPager";

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

  it("renders registration actions in the common card structure", () => {
    const container = mount(
      <div class="row">
        <RegistrationActionCard title="Confirmation Email" description="Re-queues the email.">
          <button>Resend</button>
        </RegistrationActionCard>
      </div>,
    );
    expect(container.querySelector(".card-header")?.textContent).toContain("Confirmation Email");
    expect(container.textContent).toContain("Re-queues the email.");
    expect(container.querySelector("button")?.textContent).toBe("Resend");
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
    const tabs = [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")];
    tabs[0].focus();
    void act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("attendance");
    expect(document.activeElement).toBe(tabs[2]);
    void act(() => {
      tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("settings");
    expect(document.activeElement).toBe(tabs[0]);
    void act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("attendance");
    expect(document.activeElement).toBe(tabs[2]);
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
});
