import { useEffect } from "preact/hooks";
import { authStatus, clearAuth, isAuthed, saveAuth, setAuthChecking } from "./state";
import { Login } from "./shell/Login";
import { McpOauth } from "./shell/McpOauth";
import { AdminShell } from "./shell/AdminShell";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { api } from "./api";

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
        const data = await api("/api/v1/auth/session", userAuthSessionResponseSchema);
        if (!cancelled) saveAuth(data.staff?.email ?? null);
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
