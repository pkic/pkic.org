import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

export interface PasskeyAuthenticationResult {
  admin?: { email?: string };
  member?: unknown;
}

export async function authenticateWithPasskey(): Promise<PasskeyAuthenticationResult> {
  const beginResponse = await fetch("/api/v1/auth/passkeys/authenticate/begin");
  const begin = (await beginResponse.json().catch(() => ({}))) as {
    options?: unknown;
    challengeToken?: string;
    error?: { message?: string };
  };
  if (!beginResponse.ok || !begin.options || !begin.challengeToken) {
    throw new Error(begin.error?.message ?? "Could not start passkey sign-in.");
  }

  const assertion = await startAuthentication({
    optionsJSON: begin.options as PublicKeyCredentialRequestOptionsJSON,
  });
  const completeResponse = await fetch("/api/v1/auth/passkeys/authenticate/complete", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken: begin.challengeToken, response: assertion }),
  });
  const result = (await completeResponse.json().catch(() => ({}))) as PasskeyAuthenticationResult & {
    error?: { message?: string };
  };
  if (!completeResponse.ok) throw new Error(result.error?.message ?? "Passkey sign-in failed.");
  return result;
}
