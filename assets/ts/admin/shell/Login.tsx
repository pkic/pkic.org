import { useState } from "preact/hooks";
import { saveAuth } from "../state";

async function requestMagicLink(email: string): Promise<void> {
  await fetch("/api/v1/admin/auth/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  // Always show success to prevent email enumeration.
}

async function verifyMagicLink(token: string): Promise<void> {
  const res = await fetch("/api/v1/admin/auth/verify-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const d: { token?: string; admin?: { email?: string }; error?: { message?: string } } =
    await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(d.error?.message ?? "The link may have expired or already been used.");
  }
  saveAuth(d.token!, d.admin?.email ?? null);
  history.replaceState({}, "", "/admin/");
}

export function Login() {
  const [sent, setSent] = useState(false);
  const [verifying, setVerifying] = useState(() =>
    Boolean(new URLSearchParams(window.location.search).get("token")),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (verifying) {
    const tok = new URLSearchParams(window.location.search).get("token");
    if (tok) {
      verifyMagicLink(tok).catch((err: unknown) => {
        setError((err as Error).message);
        setVerifying(false);
      });
    }
    return (
      <div id="verify-overlay">
        <div class="spinner-border text-success" role="status"></div>
        <p class="text-muted mb-0">Verifying your sign-in link…</p>
      </div>
    );
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!email) return;
    setSubmitting(true);
    await requestMagicLink(email).finally(() => setSubmitting(false));
    setSent(true);
  }

  return (
    <div id="login-wrap">
      <div id="login-card">
        <h2>Admin Console</h2>
        <p class="sub">Enter your admin email to receive a sign-in link.</p>
        {sent ? (
          <div id="magic-sent" class="alert alert-success mt-3">
            ✓ If this address is registered, you'll receive a sign-in link shortly.
          </div>
        ) : (
          <form id="form-magic" onSubmit={(e) => { void handleSubmit(e); }}>
            <div class="mb-3">
              <label class="form-label fw-semibold" for="inp-email">Admin email</label>
              <input
                class="form-control"
                type="email"
                id="inp-email"
                name="email"
                placeholder="john.doe@example.com"
                required
                autocomplete="email"
              />
            </div>
            <button id="btn-send" type="submit" class="btn btn-success w-100" disabled={submitting}>
              {submitting ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
        )}
        {error && <div class="alert alert-danger mt-3">✕ Sign-in failed: {error}</div>}
      </div>
    </div>
  );
}
