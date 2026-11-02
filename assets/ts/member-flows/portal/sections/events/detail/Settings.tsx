import { PromotionDesignSettings } from "./settings/PromotionDesignSettings";
import { EventLiveSettings } from "./settings/EventLiveSettings";
import { hasEventAgendaPermission } from "../event-agenda-access";
import { Tabs } from "../../../../../components/Tabs";
import type { EventDetail } from "../types";
import { EventTeamSettings } from "./settings/EventTeamSettings";
import { ProposalCallSettings } from "./settings/ProposalCallSettings";
import { GroupEventScheduling } from "../../management/GroupEventScheduling";
import { GeneralTab } from "./settings/GeneralTab";
import { SeriesManagedNotice } from "./settings/SeriesManagedNotice";
import { LazySponsorTiersTab } from "./settings/LazySponsorTiersTab";
import { RawEvidenceRetentionPolicy } from "./settings/RawEvidenceRetentionPolicy";
import { AttendanceSettings } from "./settings/AttendanceSettings";

type SettingsTab =
  | "general"
  | "location"
  | "session-types"
  | "registration"
  | "cfp"
  | "attendance"
  | "retention"
  | "scheduling"
  | "sponsor-tiers"
  | "team"
  | "live";

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string; capability?: "manage" }> = [
  { key: "general", label: "General" },
  { key: "location", label: "Location" },
  { key: "session-types", label: "Session types" },
  { key: "registration", label: "Registration" },
  { key: "cfp", label: "CFP" },
  { key: "attendance", label: "Attendance" },
  { key: "retention", label: "Retention" },
  { key: "scheduling", label: "Scheduling" },
  { key: "sponsor-tiers", label: "Sponsor Tiers" },
  { key: "team", label: "Team", capability: "manage" },
];

export function Settings({
  event,
  onUpdated,
  subTab,
  detailSegment,
}: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
  subTab?: string;
  /** The segment below a sub-tab; `"new"` under Team opens its add page. */
  detailSegment?: string;
}) {
  const visibleTabs = [
    ...SETTINGS_TABS.filter(({ capability }) => !capability || event.capabilities.includes(capability)),
    ...(hasEventAgendaPermission(event.id, "agenda:live_moderate") ? [{ key: "live" as const, label: "Studio" }] : []),
  ];
  const tab: SettingsTab = visibleTabs.find(({ key }) => key === subTab)?.key ?? "general";

  return (
    <div class="pk-stack">
      <Tabs
        items={visibleTabs
          .filter(({ key }) => !["scheduling", "sponsor-tiers"].includes(key))
          .map((item) => (item.key === "session-types" ? { ...item, label: "Program" } : item))}
        active={tab === "scheduling" ? "session-types" : tab === "sponsor-tiers" ? "registration" : tab}
        hrefFor={(key) =>
          key === "general" ? `/events/${event.slug}/settings` : `/events/${event.slug}/settings/${key}`
        }
      />
      {(tab === "session-types" || tab === "scheduling") && (
        <Tabs
          label="Program settings"
          items={[
            { key: "session-types", label: "Session types" },
            ...(hasEventAgendaPermission(event.id, "agenda:write") ? [{ key: "scheduling", label: "Scheduling" }] : []),
          ]}
          active={tab}
          hrefFor={(key) => `/events/${event.slug}/settings/${key}`}
        />
      )}
      {(tab === "registration" || tab === "sponsor-tiers") && (
        <Tabs
          label="Registration settings"
          items={[
            { key: "registration", label: "Policy" },
            { key: "sponsor-tiers", label: "Sponsor tiers" },
          ]}
          active={tab}
          hrefFor={(key) => `/events/${event.slug}/settings/${key}`}
        />
      )}

      {tab === "general" && (
        <>
          {event.seriesId ? <SeriesManagedNotice event={event} /> : <GeneralTab event={event} onUpdated={onUpdated} />}
          <PromotionDesignSettings event={event} onUpdated={onUpdated} />
        </>
      )}
      {(tab === "location" || tab === "session-types" || tab === "registration") && (
        <GeneralTab event={event} section={tab} onUpdated={onUpdated} />
      )}
      {tab === "retention" && <RawEvidenceRetentionPolicy event={event} />}
      {tab === "cfp" && <ProposalCallSettings event={event} onUpdated={onUpdated} />}
      {tab === "attendance" && <AttendanceSettings event={event} onUpdated={onUpdated} />}
      {tab === "scheduling" && (
        <GroupEventScheduling slug={event.slug} canEdit={hasEventAgendaPermission(event.id, "agenda:write")} />
      )}
      {tab === "sponsor-tiers" && (
        <LazySponsorTiersTab slug={event.slug} canWrite={event.capabilities.includes("write")} />
      )}
      {tab === "live" && <EventLiveSettings slug={event.slug} />}
      {tab === "team" && (
        <EventTeamSettings
          slug={event.slug}
          section={detailSegment?.split("/")[0]}
          personId={detailSegment?.split("/")[1]}
          teamPath={`/events/${event.slug}/settings/team`}
          timeZone={event.timezone}
          canManage={event.capabilities.includes("manage")}
          canEditStaffing={hasEventAgendaPermission(event.id, "agenda:write")}
          canReadStaffing={hasEventAgendaPermission(event.id, "agenda:read")}
        />
      )}
    </div>
  );
}
