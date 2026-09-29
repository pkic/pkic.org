import { render } from "preact";
import { useState } from "preact/hooks";
import { effect } from "@preact/signals";
import { apiStatusSchema } from "../../shared/schemas/availability";
import { formatDateTime } from "../../shared/format-date";
import { getJson } from "./api-client";
import { publishAvailability, serviceAvailability } from "./availability-state";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";

async function checkAvailability(): Promise<void> {
  const status = await getJson("/api/v1/", apiStatusSchema);
  publishAvailability(status.availability);
}
function AvailabilityNotice() {
  const state = serviceAvailability.value;
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  if (!state) return null;
  const planned = state.windows.length > 0;
  async function check() {
    setChecking(true);
    setError("");
    try {
      await checkAvailability();
    } catch {
      setError("We could not check the service status. Please try again shortly.");
    } finally {
      setChecking(false);
    }
  }
  return (
    <Alert
      tone={state.mode === "normal" && !planned ? "ok" : "warn"}
      title={
        state.mode === "maintenance"
          ? "Maintenance in progress"
          : state.mode === "emergency"
            ? "Online services paused"
            : planned
              ? "Scheduled maintenance"
              : "Online services restored"
      }
    >
      <p>{state.message}</p>
      {state.endsAt && <p>Expected to resume {formatDateTime(state.endsAt)}.</p>}
      {planned && (
        <ul>
          {state.windows.slice(0, 5).map((window) => (
            <li key={window.id}>
              {window.message} · {formatDateTime(window.startsAt)} – {formatDateTime(window.endsAt)}
              {window.policy === "notice" ? " (informational)" : ""}
            </li>
          ))}
        </ul>
      )}
      {state.mode === "normal" && !planned ? (
        <p>You can retry your action. This page has not been reloaded.</p>
      ) : (
        <Button variant="secondary" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Check again"}
        </Button>
      )}
      {error && <p role="status">{error}</p>}
    </Alert>
  );
}
/** All public pages and portal modules share one status feed; recovery never discards a form. */
export function installAvailabilityNotice(): () => void {
  const host = document.createElement("div");
  host.className = "pk";
  let shown = false;
  let wasPaused = false;
  const dispose = effect(() => {
    const state = serviceAvailability.value;
    if (state && state.mode !== "normal") wasPaused = true;
    if (state?.mode === "normal" && state.windows.length === 0 && !wasPaused) {
      render(null, host);
      return;
    }
    if (state && (state.mode !== "normal" || state.windows.length > 0)) shown = true;
    if (!shown) return;
    if (!host.isConnected) document.body.prepend(host);
    render(<AvailabilityNotice />, host);
  });
  const refresh = () => {
    if (document.visibilityState !== "hidden") void checkAvailability().catch(() => undefined);
  };
  refresh();
  const interval = window.setInterval(refresh, 60_000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    dispose();
    window.clearInterval(interval);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
    render(null, host);
    host.remove();
  };
}
