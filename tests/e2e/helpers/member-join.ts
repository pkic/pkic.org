import { expect, type Page } from "@playwright/test";
import { memberJoinVerifyResponseSchema } from "../../../assets/shared/schemas/member-join";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";

/**
 * Performs the public mailbox-proof portion of the canonical membership join
 * flow and returns the server-authorized continuation. This is shared by E2E
 * fixtures so no test bypasses the same verification boundary the UI uses.
 */
export async function verifyMembershipJoinEmail(
  page: Page,
  email: string,
  options: { unaffiliatedAttestation?: boolean } = {},
) {
  const since = await capturedEmailCount();
  const started = await page.evaluate(
    async ({ address, unaffiliatedAttestation }) => {
      const response = await fetch("/api/v1/members/join/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address, unaffiliatedAttestation }),
      });
      return { status: response.status, body: await response.json() };
    },
    { address: email, unaffiliatedAttestation: options.unaffiliatedAttestation ?? false },
  );
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body).toEqual({ status: "verification_sent" });

  const message = await waitForCapturedEmail(email, "Verify your email address", { since });
  const verificationUrl = extractEmailUrl(message, "/join/");
  const token = new URL(verificationUrl).hash.slice(1);
  const verificationToken = new URLSearchParams(token).get("verify");
  expect(verificationToken).toBeTruthy();

  const verified = await page.evaluate(async (joinToken) => {
    const response = await fetch("/api/v1/members/join/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: joinToken }),
    });
    return { status: response.status, body: await response.json() };
  }, verificationToken!);
  expect(verified.status, JSON.stringify(verified.body)).toBe(200);
  return memberJoinVerifyResponseSchema.parse(verified.body);
}
