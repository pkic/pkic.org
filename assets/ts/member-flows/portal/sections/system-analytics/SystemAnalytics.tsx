import { Tabs } from "../../../../components/Tabs";
import { AnalyticsOverview } from "./AnalyticsOverview";
import { RegistrationAnalytics } from "./RegistrationAnalytics";

type AnalyticsTab = "overview" | "registrations";

const TABS: Array<{ key: AnalyticsTab; label: string; path: string }> = [
  { key: "overview", label: "Overview", path: "/system/analytics" },
  { key: "registrations", label: "Registrations", path: "/system/analytics/registrations" },
];

const TAB_PATH: Record<string, string> = Object.fromEntries(TABS.map((item) => [item.key, item.path]));

export function SystemAnalytics({ initialTab }: { initialTab?: string }) {
  const tab: AnalyticsTab = initialTab === "registrations" ? initialTab : "overview";

  return (
    <section class="pk pk-stack" aria-labelledby="system-analytics-heading">
      <h2 id="system-analytics-heading">System analytics</h2>
      {/*
       * The shared tab strip rather than a hand-rolled `nav`: each tab is a
       * place with a URL, so it stays a wouter <Link> carrying
       * `aria-current="page"` — not a `role="tab"` that would promise
       * arrow-key movement the browser then handles as navigation. The strip
       * navigates on its own, so there is no second thing for `onChange` to
       * do.
       */}
      <Tabs
        label="System analytics"
        items={TABS.map((item) => ({ key: item.key, label: item.label }))}
        active={tab}
        hrefFor={(key) => TAB_PATH[key]}
        onChange={() => undefined}
      />
      {tab === "overview" ? <AnalyticsOverview /> : <RegistrationAnalytics />}
    </section>
  );
}
