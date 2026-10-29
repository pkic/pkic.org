import type { MailingListDeliveryProvider } from "../mailing-list-subscriptions/delivery-provider";
import type {
  ConfiguredGoogleServiceAccountEnv,
  GoogleGroupsDirectoryClient,
  GoogleGroupsSyncAction,
  GoogleGroupsMembershipOperation,
  GoogleServiceAccountEnv,
} from "./contracts";

const GOOGLE_DIRECTORY_MEMBERS_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";
export const GOOGLE_GROUPS_READONLY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
] as const;
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DIRECTORY_GROUPS_URL = "https://admin.googleapis.com/admin/directory/v1/groups";

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const match = pem.match(/-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END PRIVATE KEY-----/);
  if (!match) throw new Error("Google service account private key is not a PKCS#8 PEM private key");

  const encoded = match[1].replace(/\s+/g, "");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function readAccessToken(value: unknown): string {
  if (!value || typeof value !== "object" || !("access_token" in value)) {
    throw new Error("Google OAuth token exchange returned an invalid response");
  }
  const token = value.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Google OAuth token exchange returned an invalid response");
  }
  return token;
}

export function isGoogleGroupsSyncConfigured(env: GoogleServiceAccountEnv): env is ConfiguredGoogleServiceAccountEnv {
  return Boolean(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  );
}

async function getServiceAccountAccessToken(
  env: ConfiguredGoogleServiceAccountEnv,
  fetchImpl: typeof fetch,
  scopes: readonly string[] = [GOOGLE_DIRECTORY_MEMBERS_SCOPE],
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const signingInput = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    sub: env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
    scope: scopes.join(" "),
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3_600,
  })}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth token exchange failed: HTTP ${response.status}`);
  return readAccessToken(await response.json());
}

async function callDirectoryApi(
  fetchImpl: typeof fetch,
  accessToken: string,
  action: GoogleGroupsSyncAction,
  googleGroupEmail: string,
  memberEmail: string,
): Promise<void> {
  const membersUrl = `${GOOGLE_DIRECTORY_GROUPS_URL}/${encodeURIComponent(googleGroupEmail)}/members`;
  if (action === "add_to_list") {
    const response = await fetchImpl(membersUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ email: memberEmail, role: "MEMBER" }),
    });
    // Membership application is idempotent: an existing member is already in the desired state.
    if (!response.ok && response.status !== 409) {
      throw new Error(`Directory API add-member failed: HTTP ${response.status}`);
    }
    return;
  }

  const memberUrl = `${membersUrl}/${encodeURIComponent(memberEmail)}`;
  const membership = await fetchImpl(memberUrl, { headers: { authorization: `Bearer ${accessToken}` } });
  if (membership.status === 404) return;
  if (!membership.ok) throw new Error(`Directory API member read failed: HTTP ${membership.status}`);
  if (isProtectedDirectoryMember((await membership.json()) as DirectoryMemberRow)) return;
  const response = await fetchImpl(memberUrl, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  // Membership removal is idempotent: a missing member is already in the desired state.
  if (!response.ok && response.status !== 404) {
    throw new Error(`Directory API remove-member failed: HTTP ${response.status}`);
  }
}

interface DirectoryMemberRow {
  email?: unknown;
  role?: unknown;
  type?: unknown;
  delivery_settings?: unknown;
  status?: unknown;
}

function isProtectedDirectoryMember(member: DirectoryMemberRow) {
  return member.role !== "MEMBER" || member.type !== "USER";
}

/**
 * Reads the provider's actual membership for one group, following pagination.
 *
 * This is deliberately the only read path: reconciliation needs to know who is
 * really in the group, because a member we once confirmed and can no longer
 * see has left. Suspended members are reported separately from absent ones —
 * a suspended account is still a member and must not be read as an
 * unsubscribe.
 */
async function listDirectoryMembers(
  fetchImpl: typeof fetch,
  accessToken: string,
  googleGroupEmail: string,
  maxPages: number,
): Promise<{ emails: string[]; members: DirectoryMemberRow[]; complete: boolean }> {
  const emails: string[] = [];
  const members: DirectoryMemberRow[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${GOOGLE_DIRECTORY_GROUPS_URL}/${encodeURIComponent(googleGroupEmail)}/members`);
    url.searchParams.set("maxResults", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Directory API list-members failed: HTTP ${response.status}`);
    const body = (await response.json()) as { members?: DirectoryMemberRow[]; nextPageToken?: unknown };
    for (const member of body.members ?? []) {
      if (typeof member.email !== "string") throw new Error("Provider returned a member without an email address");
      members.push(member);
      // SUSPENDED accounts remain members; only true absence signals a leave.
      if (member.status === "SUSPENDED") {
        emails.push(member.email.toLowerCase());
        continue;
      }
      emails.push(member.email.toLowerCase());
    }
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
    if (!pageToken) return { emails, members, complete: true };
  }
  // Never infer an unsubscribe from a partial listing.
  return { emails, members, complete: false };
}

export async function createGoogleGroupsDirectoryClient(
  env: ConfiguredGoogleServiceAccountEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleGroupsDirectoryClient> {
  const accessToken = await getServiceAccountAccessToken(env, fetchImpl);
  return {
    applyMembership: ({ action, googleGroupEmail, memberEmail }) =>
      callDirectoryApi(fetchImpl, accessToken, action, googleGroupEmail, memberEmail),
    listMembers: (googleGroupEmail, maxPages = 25) =>
      listDirectoryMembers(fetchImpl, accessToken, googleGroupEmail, maxPages),
  };
}

/** A separate factory ensures a dry-run client never obtains write authority. */
export async function createGoogleGroupsDryRunDirectoryClient(
  env: ConfiguredGoogleServiceAccountEnv,
  operations: GoogleGroupsMembershipOperation[],
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleGroupsDirectoryClient> {
  const accessToken = await getServiceAccountAccessToken(env, fetchImpl, GOOGLE_GROUPS_READONLY_SCOPES);
  const listings = new Map<string, Promise<{ emails: string[]; complete: boolean }>>();
  return {
    listMembers: (group, maxPages = 25) => listDirectoryMembers(fetchImpl, accessToken, group, maxPages),
    async applyMembership(operation) {
      let listing = listings.get(operation.googleGroupEmail);
      if (!listing) {
        listing = listDirectoryMembers(fetchImpl, accessToken, operation.googleGroupEmail, 25);
        listings.set(operation.googleGroupEmail, listing);
      }
      const members = await listing;
      if (!members.complete) throw new Error("Incomplete Google Group membership listing; no plan recorded");
      // Record intent even if already satisfied: the live adapter applies it idempotently.
      operations.push({ ...operation });
    },
  };
}

/** Google roles and delivery flags stay inside the provider adapter. */
export async function createGoogleGroupsDeliveryProvider(
  env: ConfiguredGoogleServiceAccountEnv,
  readOnly = false,
  fetchImpl: typeof fetch = fetch,
): Promise<MailingListDeliveryProvider> {
  const token = await getServiceAccountAccessToken(
    env,
    fetchImpl,
    readOnly ? GOOGLE_GROUPS_READONLY_SCOPES : undefined,
  );
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    async listMembers(listEmail) {
      const listing = await listDirectoryMembers(fetchImpl, token, listEmail, 25);
      return {
        complete: listing.complete,
        members: listing.members.map((member) => ({
          email: String(member.email).toLowerCase(),
          protected: isProtectedDirectoryMember(member),
          delivery: member.delivery_settings === "NONE" ? ("none" as const) : ("all" as const),
        })),
      };
    },
    async applyChange(listEmail, change) {
      if (readOnly) throw new Error("Dry run cannot change provider memberships");
      const collection = `${GOOGLE_DIRECTORY_GROUPS_URL}/${encodeURIComponent(listEmail)}/members`;
      const memberUrl = `${collection}/${encodeURIComponent(change.email)}`;
      const response = await fetchImpl(memberUrl, { headers });
      let current: DirectoryMemberRow | null;
      if (response.ok) current = (await response.json()) as DirectoryMemberRow;
      else if (response.status === 404) current = null;
      else {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (response.status !== 400 || body?.error?.message !== "Missing required field: memberKey")
          throw new Error(`Provider member read failed: HTTP ${response.status}`);
        // Google can reject an email lookup for a non-member with this 400 rather
        // than 404. Establish absence independently before allowing an addition.
        const roster = await listDirectoryMembers(fetchImpl, token, listEmail, 25);
        if (!roster.complete || roster.emails.includes(change.email.toLowerCase()))
          throw new Error("Provider member lookup failed; complete roster did not confirm absence");
        current = null;
      }
      if (current && isProtectedDirectoryMember(current)) return;
      if (change.action === "unsubscribe") {
        if (!current) return;
        const removed = await fetchImpl(memberUrl, { method: "DELETE", headers });
        if (!removed.ok && removed.status !== 404) throw new Error(`Provider removal failed: HTTP ${removed.status}`);
      } else if (!current && change.action === "subscribe") {
        const added = await fetchImpl(collection, {
          method: "POST",
          headers,
          body: JSON.stringify({
            email: change.email,
            role: "MEMBER",
            ...(change.delivery === "none" ? { delivery_settings: "NONE" } : {}),
          }),
        });
        if (!added.ok && added.status !== 409) throw new Error(`Provider addition failed: HTTP ${added.status}`);
        if (added.status === 409 && change.delivery === "none")
          throw new Error("Membership changed; retry alias delivery with fresh state");
      } else if (
        current &&
        (change.action === "disable_delivery" || change.delivery === "none") &&
        current.delivery_settings !== "NONE"
      ) {
        const updated = await fetchImpl(memberUrl, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ delivery_settings: "NONE" }),
        });
        if (!updated.ok) throw new Error(`Provider delivery update failed: HTTP ${updated.status}`);
      }
    },
  };
}
