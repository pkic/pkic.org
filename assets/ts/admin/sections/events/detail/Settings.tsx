import { Tabs } from "../../../../components/Tabs";
import type { EventDetail } from "../../../types";
import { Team } from "./Team";
import { DaysTab } from "./settings/DaysTab";
import { GeneralTab } from "./settings/GeneralTab";
import { SponsorTiersTab } from "./settings/SponsorTiersTab";
import { TermsTab } from "./settings/TermsTab";

type SettingsTab = "general" | "days" | "terms" | "sponsor-tiers" | "team";

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "general", label: "General" },
  { key: "days", label: "Days" },
  { key: "terms", label: "Terms" },
  { key: "sponsor-tiers", label: "Sponsor Tiers" },
  { key: "team", label: "Team" },
];

export function Settings({
  event,
  onUpdated,
  subTab,
}: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
  subTab?: string;
}) {
  const tab: SettingsTab = SETTINGS_TABS.find(({ key }) => key === subTab)?.key ?? "general";

  return (
    <div>
      <Tabs
        items={SETTINGS_TABS}
        active={tab}
        onChange={(key) => {
          location.hash = `/events/${event.slug}/settings/${key}`;
        }}
      />

      {tab === "general" && <GeneralTab event={event} onUpdated={onUpdated} />}
      {tab === "days" && <DaysTab slug={event.slug} timezone={event.timezone} />}
      {tab === "terms" && <TermsTab slug={event.slug} />}
      {tab === "sponsor-tiers" && <SponsorTiersTab slug={event.slug} />}
      {tab === "team" && <Team slug={event.slug} />}
    </div>
  );
}
