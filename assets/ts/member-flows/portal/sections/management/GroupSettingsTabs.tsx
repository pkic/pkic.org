/**
 * The group's settings, as one page with two tabs.
 *
 * The general settings and the membership-category eligibility rules used to
 * be two panels stacked down the Settings tab, each with its own heading and
 * its own Save (#35). They are one subject — how this group is configured —
 * and a reader looking for eligibility had to scroll past a form they were
 * not editing to find it. Two tabs say what the page holds without making
 * anyone scroll to discover the second half.
 *
 * The active tab is in the URL like every other tab in the workspace, so a
 * link to the eligibility rules opens on the eligibility rules.
 */
import { lazy, Suspense } from "preact/compat";
import type { GroupSettingsDetail } from "../../../../../shared/schemas/groups";
import { Spinner } from "../../../../components/Spinner";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { useHashQueryParam } from "../../../../hooks/useHashQueryParam";
import { BreadcrumbBranch } from "../../../../ui/BreadcrumbScope";
import { GroupSettingsForm } from "./GroupSettingsForm";

const GroupCategoryRulesEditor = lazy(() =>
  import("./GroupCategoryRulesEditor").then((module) => ({ default: module.GroupCategoryRulesEditor })),
);

type SettingsTab = "general" | "eligibility";

const SETTINGS_TABS: TabItem[] = [
  { key: "general", label: "General", panelId: "group-settings-general-panel" },
  { key: "eligibility", label: "Eligibility", panelId: "group-settings-eligibility-panel" },
];

export function GroupSettingsTabs({
  group,
  onUpdated,
}: {
  group: GroupSettingsDetail;
  onUpdated: () => Promise<void>;
}) {
  const [rawTab, setTab] = useHashQueryParam("settingsTab", "general");
  const tab: SettingsTab = rawTab === "eligibility" ? "eligibility" : "general";

  return (
    <div class="pk-stack">
      <BreadcrumbBranch items={[{ label: SETTINGS_TABS.find((item) => item.key === tab)?.label ?? tab }]} />
      {/* Named, so it is not one of several anonymous "Sections" strips when
          a reader lists the page's landmarks. */}
      <Tabs
        label="Group settings"
        items={SETTINGS_TABS}
        active={tab}
        idPrefix="group-settings-tabs"
        onChange={(key) => setTab(key)}
      />
      {tab === "general" && (
        <div id="group-settings-general-panel" role="tabpanel" aria-labelledby="group-settings-tabs-general">
          <GroupSettingsForm group={group} onUpdated={onUpdated} />
        </div>
      )}
      {tab === "eligibility" && (
        <div id="group-settings-eligibility-panel" role="tabpanel" aria-labelledby="group-settings-tabs-eligibility">
          <Suspense fallback={<Spinner />}>
            <GroupCategoryRulesEditor groupId={group.id} onUpdated={onUpdated} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
