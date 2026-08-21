import type {
  ConfiguredGoogleServiceAccountEnv,
  GoogleGroupsDirectoryClient,
  GoogleGroupsSyncAction,
  GoogleServiceAccountEnv,
} from "./contracts";

const GOOGLE_DIRECTORY_MEMBERS_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";
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
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const signingInput = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    sub: env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
    scope: GOOGLE_DIRECTORY_MEMBERS_SCOPE,
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

  const response = await fetchImpl(`${membersUrl}/${encodeURIComponent(memberEmail)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  // Membership removal is idempotent: a missing member is already in the desired state.
  if (!response.ok && response.status !== 404) {
    throw new Error(`Directory API remove-member failed: HTTP ${response.status}`);
  }
}

export async function createGoogleGroupsDirectoryClient(
  env: ConfiguredGoogleServiceAccountEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleGroupsDirectoryClient> {
  const accessToken = await getServiceAccountAccessToken(env, fetchImpl);
  return {
    applyMembership: ({ action, googleGroupEmail, memberEmail }) =>
      callDirectoryApi(fetchImpl, accessToken, action, googleGroupEmail, memberEmail),
  };
}
