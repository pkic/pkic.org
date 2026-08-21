import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  passkeyBeginResponseSchema,
  passkeysListResponseSchema,
  passkeySummarySchema,
  type PasskeySummary,
} from "../../shared/schemas/passkeys";
import { deleteJson, getJson, postJson } from "../shared/api-client";
import { formatDateTime, showToast } from "../shared/ui";
import { ErrorAlert } from "./ErrorAlert";
import { Spinner } from "./Spinner";

export function PasskeySettings({
  toastTargetId,
  title = "Passkeys",
  className = "",
  tableHeaderClass = "",
}: {
  toastTargetId: string;
  title?: string;
  className?: string;
  tableHeaderClass?: string;
}) {
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  const load = useCallback(async () => {
    try {
      const response = passkeysListResponseSchema.parse(await getJson<unknown>("/api/v1/auth/passkeys"));
      setPasskeys(response.passkeys);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEnroll(event: Event) {
    event.preventDefault();
    setEnrolling(true);
    try {
      const begin = passkeyBeginResponseSchema.parse(
        await postJson<unknown>("/api/v1/auth/passkeys/register/begin", undefined),
      );
      const credential = await startRegistration({
        optionsJSON: begin.options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      passkeySummarySchema.parse(
        await postJson<unknown>("/api/v1/auth/passkeys/register/complete", {
          challengeToken: begin.challengeToken,
          response: credential,
          deviceName: deviceName.trim() || undefined,
        }),
      );
      showToast(toastTargetId, "Passkey added", "success");
      setDeviceName("");
      await load();
    } catch (reason) {
      showToast(toastTargetId, (reason as Error).message, "error");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleRemove(passkey: PasskeySummary) {
    if (!confirm(`Remove passkey "${passkey.deviceName ?? "Unnamed passkey"}"?`)) return;
    try {
      await deleteJson(`/api/v1/auth/passkeys/${passkey.id}`);
      showToast(toastTargetId, "Passkey removed", "success");
      await load();
    } catch (reason) {
      showToast(toastTargetId, (reason as Error).message, "error");
    }
  }

  if (error) return <ErrorAlert error={error} />;

  return (
    <div class={`card border-0 shadow-sm ${className}`.trim()}>
      <div class="card-header bg-white fw-semibold">{title}</div>
      <div class="card-body">
        <p class="text-muted small">
          Passkeys let you sign in with Touch ID, Face ID, or a hardware security key instead of a magic link. You can
          register more than one device.
        </p>

        {passkeysSupported ? (
          <form onSubmit={handleEnroll} class="d-flex gap-2 align-items-end flex-wrap mb-3">
            <div>
              <label class="form-label small fw-semibold">Device name (optional)</label>
              <input
                class="form-control form-control-sm"
                value={deviceName}
                onInput={(event) => setDeviceName((event.target as HTMLInputElement).value)}
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
            <thead class={tableHeaderClass || undefined}>
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
                passkeys.map((passkey) => (
                  <tr key={passkey.id}>
                    <td class="fw-semibold">{passkey.deviceName ?? "Unnamed passkey"}</td>
                    <td class="small">
                      {passkey.lastUsedAt ? formatDateTime(passkey.lastUsedAt) : <span class="text-muted">Never</span>}
                    </td>
                    <td class="small mono">{formatDateTime(passkey.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-danger"
                        onClick={() => void handleRemove(passkey)}
                      >
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
