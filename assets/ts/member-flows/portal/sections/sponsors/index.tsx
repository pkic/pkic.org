import { useState } from "preact/hooks";
import type { SponsorCapacity } from "../../../../../shared/schemas/sponsor-access";
import { EmptyState } from "../../../../components/EmptyState";
import { Tabs } from "../../../../components/Tabs";
import { Field } from "../../../../ui/Field";
import { Select } from "../../../../ui/TextControl";
import { SponsorAttendees } from "./Attendees";
import { Sponsorships as SponsorManagement } from "./management";
import { SponsorshipTierConfig } from "./management/SponsorshipTierConfig";

type SponsorWorkspaceView = "management" | "attendees" | "settings";

/** Prefixes the tab and panel ids so each tab can point at what it controls. */
const TAB_PREFIX = "sponsor-workspace-tabs";

export function SponsorWorkspace({
  sponsors,
  canRead,
  canWrite,
  detailId,
  onSessionExpired,
}: {
  sponsors: SponsorCapacity[];
  canRead: boolean;
  canWrite: boolean;
  detailId?: string;
  onSessionExpired: () => void;
}) {
  const canManage = canRead || canWrite;
  const hasAttendeesCapacity = sponsors.length > 0;
  const [view, setView] = useState<SponsorWorkspaceView>(() => (canManage ? "management" : "attendees"));
  const [selectedSponsorId, setSelectedSponsorId] = useState(() => sponsors[0]?.sponsorId ?? "");
  const selectedSponsor = sponsors.find((capacity) => capacity.sponsorId === selectedSponsorId) ?? sponsors[0] ?? null;

  if (!canManage && sponsors.length === 0) {
    return <EmptyState title="No sponsor access is assigned to this session." />;
  }

  const tabs: Array<{ key: SponsorWorkspaceView; label: string }> = [
    ...(canManage ? [{ key: "management" as const, label: "Management" }] : []),
    ...(hasAttendeesCapacity ? [{ key: "attendees" as const, label: "Attendees" }] : []),
    ...(canWrite ? [{ key: "settings" as const, label: "Settings" }] : []),
  ];

  // Reachable views are only those with a visible tab (or the sponsorship
  // detail view, which is always Management); fall back rather than strand
  // the workspace on a tab that a capacity change made unavailable.
  const activeView: SponsorWorkspaceView = detailId
    ? "management"
    : tabs.some((item) => item.key === view)
      ? view
      : (tabs[0]?.key ?? "management");

  /*
   * These tabs swap a panel that is already on the page — nothing navigates —
   * so they are the ARIA tab pattern rather than links: buttons carrying
   * `role="tab"`, one of them in the tab order, arrows moving between them,
   * and each one naming the panel it controls. The hand-rolled strip they
   * replace was a row of buttons claiming `aria-current="page"`, which says
   * "this is the current page" about something that is not a page.
   */
  const showTabs = !detailId && tabs.length > 1;

  return (
    <div class="pk pk-stack">
      {showTabs && (
        <Tabs
          items={tabs.map((item) => ({ key: item.key, label: item.label, panelId: `${TAB_PREFIX}-${item.key}-panel` }))}
          active={activeView}
          label="Sponsor workspace"
          idPrefix={TAB_PREFIX}
          onChange={(key) => setView(key as SponsorWorkspaceView)}
        />
      )}

      <div
        id={showTabs ? `${TAB_PREFIX}-${activeView}-panel` : undefined}
        role={showTabs ? "tabpanel" : undefined}
        aria-labelledby={showTabs ? `${TAB_PREFIX}-${activeView}` : undefined}
        class="pk-stack"
      >
        {activeView === "management" ? (
          <SponsorManagement canRead={canRead} canWrite={canWrite} detailId={detailId} />
        ) : activeView === "settings" ? (
          <SponsorshipTierConfig canWrite={canWrite} />
        ) : selectedSponsor ? (
          <>
            {sponsors.length > 1 && (
              <div class="content-width-xl">
                <Field label="Sponsorship">
                  {(control) => (
                    <Select
                      {...control}
                      value={selectedSponsor.sponsorId}
                      onChange={(event) => setSelectedSponsorId(event.currentTarget.value)}
                    >
                      {sponsors.map((capacity) => (
                        <option key={capacity.sponsorId} value={capacity.sponsorId}>
                          {capacity.eventName ?? capacity.eventSlug} — {capacity.tier}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <SponsorAttendees capacity={selectedSponsor} onUnauthorized={onSessionExpired} />
          </>
        ) : null}
      </div>
    </div>
  );
}
