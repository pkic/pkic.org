/**
 * The join page with a person signed in or not: its server-rendered markup and
 * the session, profile and membership-path answers the page asks for.
 */
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { vi } from "vitest";
import { myProfileSchema } from "../../../assets/shared/schemas/me";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import {
  sessionActingIdentitySchema,
  type SessionActingIdentity,
} from "../../../assets/shared/session-acting-identity";
import { JoinFlow } from "../../../assets/ts/site/JoinFlow";

export const JOIN_USER_ID = "00000000-0000-4000-8000-000000000061";
export const JOIN_EMAIL = "ada@example-corp.test";

export const personalIdentity = sessionActingIdentitySchema.parse({
  id: "00000000-0000-4000-8000-000000000062",
  organizationId: null,
  organizationName: null,
  jobTitle: null,
});

function session(identities: readonly SessionActingIdentity[]) {
  return userAuthSessionResponseSchema.parse({
    success: true,
    sessionId: "00000000-0000-4000-8000-000000000066",
    expiresAt: "2099-12-31T23:59:59.000Z",
    idleExpiresAt: "2099-12-31T23:59:59.000Z",
    identity: { id: JOIN_USER_ID, email: JOIN_EMAIL },
    actingIdentities: identities,
    actingIdentityId: identities[0]!.id,
  });
}

function profile(identity: SessionActingIdentity) {
  return myProfileSchema.parse({
    userId: JOIN_USER_ID,
    identityId: identity.id,
    emailId: null,
    email: JOIN_EMAIL,
    emailAddresses: [],
    firstName: "Ada",
    lastName: "Lovelace",
    preferredName: null,
    jobTitle: identity.jobTitle,
    biography: "I work on PKI.",
    links: [],
    membershipCategory: null,
    organizationId: identity.organizationId,
    organizationName: identity.organizationName,
    memberSince: null,
    showOnOrgProfile: false,
    headshotUrl: null,
    isOrgContact: false,
    organizationIdentities: null,
    activeIdentities: [],
  });
}

export interface JoinRequest {
  path: string;
  body: unknown;
}

/**
 * Draws the join page and answers its requests. `identities` is who is signed
 * in (none for a visitor); `answer` handles every other request and may throw
 * to stand for a network failure. Returns the requests the page made.
 */
export function openJoinPage(
  identities: readonly SessionActingIdentity[] | null,
  answer: (request: JoinRequest) => Response | Promise<Response> = () => new Response(null, { status: 404 }),
): JoinRequest[] {
  document.body.innerHTML = renderToString(h(JoinFlow, { documents: [] }));
  const requests: JoinRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/auth/session")
        return identities
          ? Response.json(session(identities))
          : Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in" } }, { status: 401 });
      if (path === "/api/v1/users/current" && identities) return Response.json(profile(identities[0]!));
      const request = { path, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      requests.push(request);
      return answer(request);
    }),
  );
  return requests;
}
