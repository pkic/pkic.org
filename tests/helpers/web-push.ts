import { encodeBase64Url, decodeBase64Url } from "../../functions/_lib/utils/sealed-value";
import type { WebPushEnvironment } from "../../functions/_lib/services/event-participation/web-push-configuration";
import type { WebPushSubscription } from "../../assets/shared/schemas/event-web-push";
export async function webPushFixture() {
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", vapid.privateKey);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", vapid.publicKey));
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const receiverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const config: WebPushEnvironment = {
    VAPID_PUBLIC_KEY: encodeBase64Url(publicBytes),
    VAPID_PRIVATE_KEY: privateJwk.d!,
    VAPID_SUBJECT: "mailto:events@pkic.org",
    WEB_PUSH_ENCRYPTION_KEY: "test-only-push-encryption-key-at-least-32-characters",
  };
  const subscription: WebPushSubscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
    expirationTime: null,
    keys: { p256dh: encodeBase64Url(receiverPublic), auth: encodeBase64Url(auth) },
  };
  return { config, subscription, receiver, receiverPublic, auth };
}
function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
async function hmac(key: Uint8Array, value: Uint8Array) {
  const imported = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, value as BufferSource));
}
/** Independent RFC8291 receiver implementation, used only as transport evidence. */
export async function decryptPushFixture(body: ArrayBuffer, fixture: Awaited<ReturnType<typeof webPushFixture>>) {
  const bytes = new Uint8Array(body),
    salt = bytes.slice(0, 16),
    keyLength = bytes[20],
    senderPublic = bytes.slice(21, 21 + keyLength);
  const sender = await crypto.subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: sender }, fixture.receiver.privateKey, 256),
  );
  const encoder = new TextEncoder(),
    one = new Uint8Array([1]);
  const authKey = await hmac(fixture.auth, shared);
  const ikm = await hmac(authKey, concat(encoder.encode("WebPush: info\0"), fixture.receiverPublic, senderPublic, one));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(encoder.encode("Content-Encoding: aes128gcm\0"), one))).slice(0, 16);
  const nonce = (await hmac(prk, concat(encoder.encode("Content-Encoding: nonce\0"), one))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, bytes.slice(21 + keyLength)),
  );
  let end = plaintext.length - 1;
  while (plaintext[end] === 0) end--;
  if (plaintext[end] !== 2) throw new Error("Invalid final push record delimiter");
  return JSON.parse(new TextDecoder().decode(plaintext.slice(0, end)));
}
export async function verifyVapidFixture(header: string, fixture: Awaited<ReturnType<typeof webPushFixture>>) {
  const token = /^vapid t=([^,]+), k=/.exec(header)?.[1];
  if (!token) throw new Error("Invalid VAPID authorization scheme");
  const [head, payload, signature] = token.split(".");
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await crypto.subtle.importKey(
      "raw",
      decodeBase64Url(fixture.config.VAPID_PUBLIC_KEY!),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    ),
    decodeBase64Url(signature),
    new TextEncoder().encode(`${head}.${payload}`),
  );
  return { valid, claims: JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) };
}
