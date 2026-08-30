import { Link } from "wouter";
import { AnalyticsOverview } from "./AnalyticsOverview";
import { RegistrationAnalytics } from "./RegistrationAnalytics";

type AnalyticsTab = "overview" | "registrations";

const TABS: Array<{ key: AnalyticsTab; label: string; path: string }> = [
  { key: "overview", label: "Overview", path: "/system/analytics" },
  { key: "registrations", label: "Registrations", path: "/system/analytics/registrations" },
];

export function SystemAnalytics({ initialTab }: { initialTab?: string }) {
  const tab: AnalyticsTab = initialTab === "registrations" ? initialTab : "overview";

  return (
    <section aria-labelledby="system-analytics-heading">
      <h5 id="system-analytics-heading" class="mb-3">
        System Analytics
      </h5>
      <nav class="nav nav-tabs mb-3" aria-label="System analytics">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={item.path}
            class={`nav-link${item.key === tab ? " active" : ""}`}
            aria-current={item.key === tab ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "overview" ? <AnalyticsOverview /> : <RegistrationAnalytics />}
    </section>
  );
}
