import { useState } from "preact/hooks";
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
      if (reason instanceof Error || reason instanceof DOMException) {
        // SimpleWebAuthn wraps browser refusals in an Error with the DOMException as its cause.
        const cause = reason instanceof Error ? reason.cause : undefined;
        const name = cause instanceof Error || cause instanceof DOMException ? cause.name : reason.name;
        if (name === "NotAllowedError") {
          return "Passkey creation was canceled or declined. Unlock your password manager or choose another passkey provider, then try again.";
        }
        if (name === "InvalidStateError") {
          return "This provider already has a passkey for your account. Use the existing passkey to sign in, or choose another provider.";
        }
        if (reason.message.trim()) return reason.message;
      }
      return "The passkey could not be added. Check your password manager or device and try again.";
    } finally {
      setEnrolling(false);
    }
  }

  return { enroll, enrolling };
}
