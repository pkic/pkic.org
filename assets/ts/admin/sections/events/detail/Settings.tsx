import { Tabs } from "../../../../components/Tabs";
import type { EventDetail } from "../../../types";
import { Team } from "./Team";
import { GeneralTab } from "./settings/GeneralTab";
import { SponsorTiersTab } from "./settings/SponsorTiersTab";

type SettingsTab = "general" | "sponsor-tiers" | "team";

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "general", label: "General" },
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
      {tab === "sponsor-tiers" && <SponsorTiersTab slug={event.slug} />}
      {tab === "team" && <Team slug={event.slug} />}
    </div>
  );
}
