import { useEffect } from "preact/hooks";
import { authStatus, clearAuth, isAuthed, saveAuth, setAuthChecking } from "./state";
import { Login } from "./shell/Login";
import { McpOauth } from "./shell/McpOauth";
import { AdminShell } from "./shell/AdminShell";

/**
 * Root component — gates on auth state.
 *
 * `isAuthed` is driven by a server-backed session probe and swaps between
 * Login and AdminShell
 * without a full page reload.
 */
export function App() {
  const isMcpOauthFlow = new URLSearchParams(window.location.search).get("flow") === "mcp-oauth";

  useEffect(() => {
    if (isMcpOauthFlow) {
      return;
    }

    let cancelled = false;

    async function loadSession() {
      setAuthChecking();
      try {
        const res = await fetch("/api/v1/admin/auth/session", { credentials: "same-origin" });
        if (res.status === 401) {
          if (!cancelled) clearAuth();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { admin?: { email?: string | null } };
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (!cancelled) saveAuth(data.admin?.email ?? null);
      } catch {
        if (!cancelled) clearAuth();
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [isMcpOauthFlow]);

  if (isMcpOauthFlow) {
    return <McpOauth />;
  }

  if (authStatus.value === "loading") {
    return (
      <div id="verify-overlay">
        <div class="spinner-border text-success" role="status"></div>
        <p class="text-muted mb-0">Checking your session...</p>
      </div>
    );
  }

  return isAuthed.value ? <AdminShell /> : <Login />;
}
