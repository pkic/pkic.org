import { useEffect, useState } from "preact/hooks";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

import { postJson } from "../shared/api-client";
import { passkeyBeginResponseSchema, passkeySummarySchema } from "../../shared/schemas/passkeys";

/**
 * Enrolling a passkey, as one command.
 *
 * The ceremony is three steps that only mean anything together — ask the
 * server for options, run the browser's registration, hand the credential
 * back — and both the account settings panel and the offer made after an email
 * sign-in perform it. Keeping one implementation is what stops the two from
 * drifting into subtly different ceremonies against the same endpoints.
 */
export function usePasskeyEnrollment() {
  const [enrolling, setEnrolling] = useState(false);

  /**
   * Runs the ceremony, resolving to the failure message or `null` on success.
   *
   * The refusal is returned rather than thrown because every caller reports it
   * somewhere of its own — a toast beside the settings table, a message inside
   * the offer — and neither wants a rejected promise to handle.
   */
  async function enroll(deviceName?: string): Promise<string | null> {
    setEnrolling(true);
    try {
      const begin = await postJson("/api/v1/auth/passkeys/register/begin", undefined, passkeyBeginResponseSchema);
      const credential = await startRegistration({
        optionsJSON: begin.options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      await postJson(
        "/api/v1/auth/passkeys/register/complete",
        {
          challengeToken: begin.challengeToken,
          response: credential,
          deviceName: deviceName?.trim() || undefined,
        },
        passkeySummarySchema,
      );
      return null;
    } catch (reason) {
      return (reason as Error).message;
    } finally {
      setEnrolling(false);
    }
  }

  return { enroll, enrolling };
}

/**
 * The refusals a silent upgrade is expected to produce.
 *
 * Conditional create asks the platform to make a passkey only if it judges the
 * moment right. A platform that declines, a provider that already holds one,
 * and an aborted call are all ordinary outcomes rather than faults, and the
 * browser has already shown the reader nothing — so there is nothing to
 * report and nothing to retry.
 */
const SILENT_REFUSALS = new Set(["InvalidStateError", "NotAllowedError", "AbortError"]);

/**
 * Tries to create a passkey without asking, after a sign-in that used one of
 * the older methods.
 *
 * This is WebAuthn's conditional create — "automatic passkey upgrades" — and
 * it is the only thing that can answer the question this feature really turns
 * on: whether this device is one the reader should be leaving a credential on.
 * No web API reports that, and no heuristic of ours would be better than a
 * guess. The platform's own passkey provider decides, having watched the
 * reader sign in, and it declines silently when it is not sure.
 *
 * `excludeCredentials` comes from the begin endpoint, which is what stops a
 * second passkey being made in a provider that already holds one.
 */
export async function attemptAutomaticPasskeyUpgrade(): Promise<void> {
  try {
    if (!(await conditionalCreateSupported())) return;
    const begin = await postJson("/api/v1/auth/passkeys/register/begin", undefined, passkeyBeginResponseSchema);
    const credential = await startRegistration({
      optionsJSON: begin.options as unknown as PublicKeyCredentialCreationOptionsJSON,
      useAutoRegister: true,
    });
    await postJson(
      "/api/v1/auth/passkeys/register/complete",
      { challengeToken: begin.challengeToken, response: credential },
      passkeySummarySchema,
    );
  } catch (reason) {
    if (reason instanceof Error && SILENT_REFUSALS.has(reason.name)) return;
    // Anything else is this application's own failure — a refused begin, a
    // rejected complete — and the reader asked for none of it, so it stays out
    // of their way. Account settings remains the way to add one deliberately.
  }
}

/**
 * Whether this browser can be asked to create a passkey without a prompt.
 *
 * `getClientCapabilities` reports the browser's capability only; the passkey
 * provider behind it may still decline, which is why the attempt itself has to
 * tolerate refusal.
 */
async function conditionalCreateSupported(): Promise<boolean> {
  const api = typeof window === "undefined" ? undefined : window.PublicKeyCredential;
  if (!api?.getClientCapabilities) return false;
  try {
    return Boolean((await api.getClientCapabilities()).conditionalCreate);
  } catch {
    return false;
  }
}

/**
 * Runs the automatic upgrade once, for a session that began with an emailed
 * link.
 *
 * Placed at the sign-in rather than in account settings deliberately: the
 * upgrade only works while the platform still associates this reader with the
 * sign-in they just completed, and it shows them nothing either way. The
 * *visible* offer belongs elsewhere — FIDO's own research found prompting to
 * create a passkey during sign-in performed worse than prompting alongside
 * account tasks, where the reader is already thinking about their account.
 */
export function useAutomaticPasskeyUpgrade(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void attemptAutomaticPasskeyUpgrade();
    // Once per sign-in: `active` is the flag the verify step raised, and it is
    // cleared on sign-out.
  }, [active]);
}
