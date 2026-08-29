import { useState } from "preact/hooks";
import type { SponsorCapacity } from "../../../../../shared/schemas/sponsor-access";
import { SponsorAttendees } from "./Attendees";
import { Sponsorships as SponsorManagement } from "./management";

type SponsorWorkspaceView = "management" | "attendees";

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
  const [view, setView] = useState<SponsorWorkspaceView>(() => (canManage ? "management" : "attendees"));
  const [selectedSponsorId, setSelectedSponsorId] = useState(() => sponsors[0]?.sponsorId ?? "");
  const selectedSponsor = sponsors.find((capacity) => capacity.sponsorId === selectedSponsorId) ?? sponsors[0] ?? null;

  if (!canManage && sponsors.length === 0) {
    return <p class="text-muted">No sponsor access is assigned to this session.</p>;
  }

  return (
    <div>
      {canManage && sponsors.length > 0 && !detailId && (
        <nav class="nav nav-tabs mb-3" aria-label="Sponsor workspace">
          <button
            type="button"
            class={`nav-link${view === "management" ? " active" : ""}`}
            aria-current={view === "management" ? "page" : undefined}
            onClick={() => setView("management")}
          >
            Management
          </button>
          <button
            type="button"
            class={`nav-link${view === "attendees" ? " active" : ""}`}
            aria-current={view === "attendees" ? "page" : undefined}
            onClick={() => setView("attendees")}
          >
            Attendees
          </button>
        </nav>
      )}

      {canManage && (detailId || sponsors.length === 0 || view === "management") ? (
        <SponsorManagement canRead={canRead} canWrite={canWrite} detailId={detailId} />
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
