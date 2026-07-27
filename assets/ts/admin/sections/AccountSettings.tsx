/**
 * Account Settings → Security → Passkeys (PRD §3.5, bullets 2-3). Mirrors
 * shell/Login.tsx's startAuthentication() pattern using startRegistration()
 * for the enrollment ceremony.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { fmt, toast } from "../ui";
import type { Passkey } from "../types";

async function enrollPasskey(deviceName: string): Promise<Passkey> {
  const begin = await api<{ options: unknown; challengeToken: string }>("/api/v1/auth/passkeys/register/begin", {
    method: "POST",
  });
  const credential = await startRegistration({
    optionsJSON: begin.options as PublicKeyCredentialCreationOptionsJSON,
  });
  return api<Passkey>("/api/v1/auth/passkeys/register/complete", {
    method: "POST",
    body: JSON.stringify({
      challengeToken: begin.challengeToken,
      response: credential,
      deviceName: deviceName || undefined,
    }),
  });
}

export function AccountSettings() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  const load = useCallback(async () => {
    try {
      const data = await api<{ passkeys: Passkey[] }>("/api/v1/auth/passkeys");
      setPasskeys(data.passkeys);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEnroll(e: Event) {
    e.preventDefault();
    setEnrolling(true);
    try {
      await enrollPasskey(deviceName.trim());
      toast("Passkey added", "success");
      setDeviceName("");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleRemove(passkey: Passkey) {
    if (!confirm(`Remove passkey "${passkey.deviceName ?? "Unnamed passkey"}"?`)) return;
    try {
      await api(`/api/v1/auth/passkeys/${passkey.id}`, { method: "DELETE" });
      toast("Passkey removed", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (error) return <ErrorAlert error={error} />;

  return (
    <div class="card border-0 shadow-sm" style={{ maxWidth: "720px" }}>
      <div class="card-header bg-white fw-semibold">Security — Passkeys</div>
      <div class="card-body">
        <p class="text-muted small">
          Passkeys let you sign in with Touch ID, Face ID, or a hardware security key instead of a magic link. You can
          register more than one (e.g. laptop and phone).
        </p>

        {passkeysSupported ? (
          <form onSubmit={handleEnroll} class="d-flex gap-2 align-items-end flex-wrap mb-3">
            <div>
              <label class="form-label small fw-semibold">Device name (optional)</label>
              <input
                class="form-control form-control-sm"
                value={deviceName}
                onInput={(e) => setDeviceName((e.target as HTMLInputElement).value)}
                placeholder="e.g. Work laptop"
                disabled={enrolling}
              />
            </div>
            <button type="submit" class="btn btn-sm btn-success" disabled={enrolling}>
              {enrolling ? "Waiting for passkey…" : "Add a passkey"}
            </button>
          </form>
        ) : (
          <div class="alert alert-warning small">This browser doesn't support passkeys.</div>
        )}

        {passkeys === null ? (
          <Spinner />
        ) : (
          <table class="table table-sm table-hover mb-0">
            <thead class="table-dark">
              <tr>
                <th>Device</th>
                <th>Last used</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {passkeys.length === 0 ? (
                <tr>
                  <td colspan={4} class="text-center text-muted fst-italic py-3">
                    No passkeys registered
                  </td>
                </tr>
              ) : (
                passkeys.map((p) => (
                  <tr key={p.id}>
                    <td class="fw-semibold">{p.deviceName ?? "Unnamed passkey"}</td>
                    <td class="small">{p.lastUsedAt ? fmt(p.lastUsedAt) : <span class="text-muted">Never</span>}</td>
                    <td class="small mono">{fmt(p.createdAt)}</td>
                    <td>
                      <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRemove(p)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
