import { expect } from "vitest";
import {
  passkeyBeginResponseSchema,
  passkeyAuthenticateCompleteResponseSchema,
} from "../../assets/shared/schemas/passkeys";
import type { Env } from "../../functions/_lib/types";
import { verifyUserSessionToken } from "../../functions/_lib/auth/user-session-token";
import { callApi } from "./app";
import {
  buildAuthenticationResponse,
  buildRegistrationResponse,
  createMockAuthenticator,
} from "./webauthn-mock-authenticator";

/** Real WebAuthn verification against the mounted routes and a synthetic authenticator. */
export async function signInWithPasskey(env: Env, initialToken: string) {
  const call = (path: string, body?: unknown, token?: string) =>
    callApi(env, path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const begin = async (path: string, token?: string) => {
    const response = await call(path, path.includes("register") ? {} : undefined, token);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = passkeyBeginResponseSchema.parse(await response.json());
    if (typeof result.options.challenge !== "string") throw new Error("Missing WebAuthn challenge");
    return { challengeToken: result.challengeToken, challenge: result.options.challenge };
  };
  const registration = await begin("/api/v1/auth/passkeys/register/begin", initialToken);
  const authenticator = await createMockAuthenticator();
  const credential = await buildRegistrationResponse(authenticator, {
    challenge: registration.challenge,
    rpId: "app.test",
    origin: "https://app.test",
  });
  const registered = await call(
    "/api/v1/auth/passkeys/register/complete",
    {
      challengeToken: registration.challengeToken,
      response: credential,
      deviceName: "Synthetic authenticator",
    },
    initialToken,
  );
  expect(registered.status).toBe(201);
  const { id: credentialId } = (await registered.json()) as { id: string };
  const authentication = await begin("/api/v1/auth/passkeys/authenticate/begin");
  const assertion = await buildAuthenticationResponse(authenticator, {
    challenge: authentication.challenge,
    rpId: "app.test",
    origin: "https://app.test",
    signCount: 1,
  });
  const completed = await call("/api/v1/auth/passkeys/authenticate/complete", {
    challengeToken: authentication.challengeToken,
    response: assertion,
  });
  expect(completed.status).toBe(200);
  const publicSession = await completed.json();
  expect(publicSession).not.toHaveProperty("passkeyAuthentication");
  const session = passkeyAuthenticateCompleteResponseSchema.parse(publicSession);
  const token = (completed.headers.get("set-cookie") ?? "").split("pkic_session=", 2)[1]?.split(";", 1)[0];
  if (!token || !env.INTERNAL_SIGNING_SECRET) throw new Error("Missing synthetic passkey session token");
  const verified = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok || !verified.claims.passkeyAuthentication) throw new Error("Missing verified passkey evidence");
  expect(verified.claims.passkeyAuthentication.credentialId).toBe(credentialId);
  return { token, session, credentialId, authentication: verified.claims.passkeyAuthentication };
}
