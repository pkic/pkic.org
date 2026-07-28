/**
 * Shared "not built yet" placeholder for the four Member Portal nav
 * sections out of scope for this phase (PRD §11.2's UI-2/UI-3/UI-4) — the
 * backend for each is already live and tested (§11.1's gap inventory), only
 * the frontend is pending.
 */
export function Placeholder({ upcomingPhase }: { upcomingPhase: string }) {
  return (
    <div class="alert alert-info">
      This section is coming soon — its backend is already live, and the portal UI for it is planned in {upcomingPhase}.
    </div>
  );
}
