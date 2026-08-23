import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { z } from "zod";
import { passkeyAuthenticateCompleteResponseSchema, passkeyBeginResponseSchema } from "../../shared/schemas/passkeys";
import { getJson, postJson } from "./api-client";

export type PasskeyAuthenticationResult = z.infer<typeof passkeyAuthenticateCompleteResponseSchema>;

export async function authenticateWithPasskey(): Promise<PasskeyAuthenticationResult> {
  const begin = await getJson("/api/v1/auth/passkeys/authenticate/begin", passkeyBeginResponseSchema);

  const assertion = await startAuthentication({
    optionsJSON: begin.options as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
  return postJson(
    "/api/v1/auth/passkeys/authenticate/complete",
    { challengeToken: begin.challengeToken, response: assertion },
    passkeyAuthenticateCompleteResponseSchema,
  );
}
