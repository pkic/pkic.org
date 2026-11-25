import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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

const base64url = (bytes) => Buffer.from(bytes).toString("base64url");

/** Refuses a key file inside the repository, where it could be committed. */
export function assertOutsideRepository(file, repositoryRoot) {
  const relative = path.relative(path.resolve(repositoryRoot), path.resolve(file));
  if (!relative.startsWith("..") && !path.isAbsolute(relative))
    throw new Error(`Keep the passkey file outside the repository: ${file}`);
}

/** The COSE_Key (EC2, P-256, ES256) a browser registration stores for this key. */
function coseKey(publicJwk) {
  const x = Buffer.from(publicJwk.x, "base64url");
  const y = Buffer.from(publicJwk.y, "base64url");
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
}

function newCredential() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    credentialId: base64url(randomBytes(32)),
    privateKey: privateKey.export({ format: "jwk" }),
    publicKey: base64url(coseKey(publicKey.export({ format: "jwk" }))),
  };
}

/** Reads the key file and adds a credential for every address that has none. */
export function ensurePasskeys(file, emails) {
  const store = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { version: KEY_FILE_VERSION, credentials: {} };
  if (store.version !== KEY_FILE_VERSION) throw new Error(`${file} is not a preview passkey file.`);
  let added = 0;
  for (const email of emails)
    if (!store.credentials[email]) {
      store.credentials[email] = newCredential();
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

/**
 * The assertion an authenticator returns for `challenge`: user present and
 * verified, counter 0 as synced passkeys report it.
 */
export function passkeyAssertion(credential, { challenge, origin, rpId }) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }));
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(rpId).digest(),
    Buffer.from([0x05, 0, 0, 0, 0]),
  ]);
  const signature = sign(
    "sha256",
    Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]),
    createPrivateKey({ key: credential.privateKey, format: "jwk" }),
  );
  return {
    id: credential.credentialId,
    rawId: credential.credentialId,
    type: /** @type {const} */ ("public-key"),
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64url(clientDataJSON),
      authenticatorData: base64url(authenticatorData),
      signature: base64url(signature),
    },
  };
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
    throw new Error(`${response.url}: ${response.status} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`.trim());
  return body;
}

/** Signs in through the real passkey ceremony and returns the session cookie (`name=value`). */
export async function signInWithPasskey(credential, origin) {
  const begin = await readJson(await fetch(`${origin}/api/v1/auth/passkeys/authenticate/begin`));
  const response = passkeyAssertion(credential, { challenge: begin.options.challenge, origin, rpId: begin.options.rpId });
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

/** Publishes the agenda at `revision` as the signed-in organizer, as the portal's Approve for publication does. */
export async function publishAgenda({ origin, cookie, eventSlug, revision }) {
  return readJson(
    await fetch(`${origin}/api/v1/events/${encodeURIComponent(eventSlug)}/agenda/publications`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ expectedRevision: revision }),
    }),
  );
}
