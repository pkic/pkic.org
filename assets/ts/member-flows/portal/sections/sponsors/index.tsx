import { useState } from "preact/hooks";
import type { SponsorCapacity } from "../../../../../shared/schemas/sponsor-access";
import { SponsorAttendees } from "./Attendees";
import { Sponsorships as SponsorManagement } from "./management";
import { SponsorshipTierConfig } from "./management/SponsorshipTierConfig";

type SponsorWorkspaceView = "management" | "attendees" | "settings";

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
    return <p class="text-muted">No sponsor access is assigned to this session.</p>;
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

  return (
    <div>
      {!detailId && tabs.length > 1 && (
        <nav class="nav nav-tabs mb-3" aria-label="Sponsor workspace">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              class={`nav-link${activeView === item.key ? " active" : ""}`}
              aria-current={activeView === item.key ? "page" : undefined}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {activeView === "management" ? (
        <SponsorManagement canRead={canRead} canWrite={canWrite} detailId={detailId} />
      ) : activeView === "settings" ? (
        <SponsorshipTierConfig canWrite={canWrite} />
      ) : selectedSponsor ? (
        <>
          {sponsors.length > 1 && (
            <div class="container pt-4 content-width-xl">
              <label class="form-label" for="sponsor-capacity">
                Sponsorship
              </label>
              <select
                id="sponsor-capacity"
                class="form-select"
                value={selectedSponsor.sponsorId}
                onChange={(event) => setSelectedSponsorId(event.currentTarget.value)}
              >
                {sponsors.map((capacity) => (
                  <option key={capacity.sponsorId} value={capacity.sponsorId}>
                    {capacity.eventName ?? capacity.eventSlug} — {capacity.tier}
                  </option>
                ))}
              </select>
            </div>
          )}
          <SponsorAttendees capacity={selectedSponsor} onUnauthorized={onSessionExpired} />
        </>
      ) : null}
    </div>
  );
}
