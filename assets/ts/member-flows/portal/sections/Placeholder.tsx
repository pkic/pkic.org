import { Alert } from "../../../ui/Alert";

/**
 * Shared "not built yet" placeholder for the four Member Portal nav
 * sections out of scope for this — the
 * backend for each is already live and tested, only
 * the frontend is pending.
 */
export function Placeholder({ upcomingPhase }: { upcomingPhase: string }) {
  return (
    <div class="pk">
      {/* The informational tone carries role="status", so the notice is
          announced politely instead of interrupting the reader. */}
      <Alert tone="info">
        This section is coming soon — its backend is already live, and the portal UI for it is planned in{" "}
        {upcomingPhase}.
      </Alert>
    </div>
  );
}
