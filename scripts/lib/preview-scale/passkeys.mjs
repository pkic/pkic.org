import fs from "node:fs";
import path from "node:path";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import {
  buildAuthenticationResponse,
  createMockAuthenticator,
} from "../../../tests/helpers/webauthn-mock-authenticator.ts";
import { sqlString, NOW } from "../sql.mjs";
import { previewScaleId } from "../seed-ids.mjs";
import { previewOriginIdentity } from "../../../assets/shared/preview-domain.ts";

/**
 * Software passkeys for the persona accounts, so a person or an agent can sign
 * in to a preview without a mailbox. The private keys live in one key file
 * outside the repository; the database holds only each public key, exactly as
 * a browser registration would store it.
 */
const KEY_FILE_VERSION = 1;
const DEVICE_NAME = "Preview test passkey";

/** Refuses a key file inside the repository, where it could be committed. */
export function assertOutsideRepository(file, repositoryRoot) {
  const relative = path.relative(path.resolve(repositoryRoot), path.resolve(file));
  const escapes = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!escapes) throw new Error(`Keep the passkey file outside the repository: ${file}`);
}

/** A new authenticator from the tests' software authenticator, in a form the key file can hold. */
async function newCredential() {
  const authenticator = await createMockAuthenticator();
  return {
    credentialId: isoBase64URL.fromBuffer(authenticator.credentialId),
    privateKey: await crypto.subtle.exportKey("jwk", authenticator.privateKey),
    publicKey: isoBase64URL.fromBuffer(authenticator.publicKeyCose),
  };
}

/** Reads the key file and adds a credential for every address that has none. */
export async function ensurePasskeys(file, emails) {
  const store = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { version: KEY_FILE_VERSION, credentials: {} };
  if (store.version !== KEY_FILE_VERSION) throw new Error(`${file} is not a preview passkey file.`);
  // Node applies the creation mode only to a new file; an existing key file is narrowed to its owner too.
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  let added = 0;
  for (const email of emails)
    if (!store.credentials[email]) {
      store.credentials[email] = await newCredential();
      added += 1;
    }
  if (added > 0) fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  return store;
}

export function readPasskey(file, email) {
  const credential = JSON.parse(fs.readFileSync(file, "utf8")).credentials?.[email.toLowerCase()];
  if (!credential) throw new Error(`${file} holds no passkey for ${email}.`);
  return credential;
}

/** One passkey per persona; an account keeps a credential it already holds. */
export function passkeyStatements(store, personas) {
  return personas.map((persona) => {
    const credential = store.credentials[persona.email];
    return `INSERT INTO passkey_credentials (id, user_id, credential_id, public_key, sign_count, device_name, created_at)
SELECT ${sqlString(previewScaleId(`passkey:${credential.credentialId}`))}, id, ${sqlString(credential.credentialId)}, ${sqlString(credential.publicKey)}, 0, ${sqlString(DEVICE_NAME)}, ${NOW}
FROM users WHERE normalized_email = ${sqlString(persona.email)}
ON CONFLICT DO NOTHING;`;
  });
}

/** The assertion the stored authenticator returns for `challenge`: user verified, counter 0 as synced passkeys report it. */
export async function passkeyAssertion(credential, { challenge, origin, rpId }) {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    credential.privateKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const authenticator = {
    credentialId: isoBase64URL.toBuffer(credential.credentialId),
    privateKey,
    publicKeyCose: isoBase64URL.toBuffer(credential.publicKey),
    aaguid: new Uint8Array(16),
  };
  return buildAuthenticationResponse(authenticator, { challenge, origin, rpId, signCount: 0 });
}

/** A preview or local Worker origin; anything else, production included, is refused. */
export function testOrigin(base) {
  const origin = new URL(base).origin;
  if (!/^http:\/\/localhost(:\d+)?$/.test(origin) && !previewOriginIdentity(origin))
    throw new Error(`Not a preview or local address: ${origin}`);
  return origin;
}

async function readJson(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `${response.url}: ${response.status} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`.trim(),
    );
  return body;
}

/** Signs in through the real passkey ceremony and returns the session cookie (`name=value`). */
export async function signInWithPasskey(credential, origin) {
  const begin = await readJson(await fetch(`${origin}/api/v1/auth/passkeys/authenticate/begin`));
  const response = await passkeyAssertion(credential, {
    challenge: begin.options.challenge,
    origin,
    rpId: begin.options.rpId,
  });
  const complete = await fetch(`${origin}/api/v1/auth/passkeys/authenticate/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ challengeToken: begin.challengeToken, response }),
  });
  await readJson(complete.clone());
  const cookie = complete.headers.getSetCookie()[0]?.split(";")[0];
  if (!cookie) throw new Error("The sign-in returned no session cookie.");
  return cookie;
}

/**
 * Publishes the agenda at `revision` as the signed-in organizer, as the portal's Approve for publication does.
 * D1 refuses writes for a while after a file import, so a 503 is retried with a growing wait.
 */
export async function publishAgenda({ origin, cookie, eventSlug, revision, waits = [5, 10, 20, 40, 60, 60, 60, 60] }) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${origin}/api/v1/events/${encodeURIComponent(eventSlug)}/agenda/publications`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ expectedRevision: revision }),
    });
    if (response.status !== 503 || attempt >= waits.length) return readJson(response);
    console.log(
      `The preview database is still busy after the import; retrying the publication in ${waits[attempt]} s.`,
    );
    await new Promise((resolve) => setTimeout(resolve, waits[attempt] * 1000));
  }
}
