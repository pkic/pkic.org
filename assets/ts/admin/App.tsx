import { useEffect, useState } from "preact/hooks";
import { authToken, isAuthed } from "./state";
import { Login } from "./shell/Login";
import { AdminShell } from "./shell/AdminShell";

function McpAuthorize() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("mcp_authorize") ?? "";
  const payload = (() => {
    try {
      return JSON.parse(atob(encoded)) as Record<string, string>;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (!payload) {
      setError("Invalid MCP authorization request.");
    }
  }, [payload]);

  async function approve(): Promise<void> {
    if (!payload) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/oauth/authorize/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken.value}`,
        },
        body: JSON.stringify(payload),
      });
      const data: { redirectTo?: string; error_description?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data.redirectTo) {
        throw new Error(data.error_description ?? "Unable to authorize the MCP client.");
      }
      window.location.href = data.redirectTo;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to authorize the MCP client.");
      setSubmitting(false);
    }
  }

  return (
    <div id="verify-overlay">
      {error ? (
        <div class="alert alert-danger mb-0">Authorization failed: {error}</div>
      ) : (
        <div class="text-center">
          <h2 class="h5 mb-3">Authorize Claude</h2>
          <p class="text-muted">Allow this MCP client to read event proposals and save abstract reviews.</p>
          <button
            class="btn btn-success"
            type="button"
            disabled={submitting || !payload}
            onClick={() => void approve()}
          >
            {submitting ? "Authorizing..." : "Authorize"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Root component — gates on auth state.
 *
 * `isAuthed` is a computed signal: it re-evaluates whenever `authToken`
 * changes, causing this component to swap between Login and AdminShell
 * without a full page reload.
 */
export function App() {
  if (isAuthed.value && new URLSearchParams(window.location.search).has("mcp_authorize")) {
    return <McpAuthorize />;
  }
  return isAuthed.value ? <AdminShell /> : <Login />;
}
