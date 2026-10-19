import { eventWebPushConfigurationSchema } from "../../../../assets/shared/schemas/event-web-push";
import { encodeBase64Url, decodeBase64Url } from "../../utils/sealed-value";
export interface WebPushEnvironment {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  WEB_PUSH_ENCRYPTION_KEY?: string;
}
export interface WebPushConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
  encryptionKey: string;
}
/** Configuration validity, including public/private agreement, is required before any registration or dispatch. */
export async function webPushConfiguration(env: WebPushEnvironment): Promise<WebPushConfiguration | null> {
  if (
    !env.VAPID_PUBLIC_KEY ||
    !env.VAPID_PRIVATE_KEY ||
    !env.VAPID_SUBJECT ||
    !env.WEB_PUSH_ENCRYPTION_KEY ||
    env.WEB_PUSH_ENCRYPTION_KEY.length < 32
  )
    return null;
  try {
    const publicBytes = new Uint8Array(decodeBase64Url(env.VAPID_PUBLIC_KEY));
    const privateBytes = new Uint8Array(decodeBase64Url(env.VAPID_PRIVATE_KEY));
    if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) return null;
    const subject = new URL(env.VAPID_SUBJECT);
    if (!["mailto:", "https:"].includes(subject.protocol) || subject.username || subject.password) return null;
    const jwk = {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(publicBytes.slice(1, 33)),
      y: encodeBase64Url(publicBytes.slice(33, 65)),
    };
    const signing = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, d: env.VAPID_PRIVATE_KEY },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const verifying = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
    const check = new TextEncoder().encode("PKI Consortium push configuration");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signing, check);
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifying, signature, check))) return null;
    return {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
      encryptionKey: env.WEB_PUSH_ENCRYPTION_KEY,
    };
  } catch {
    return null;
  }
}
export async function eventWebPushConfiguration(env: WebPushEnvironment) {
  const config = await webPushConfiguration(env);
  return eventWebPushConfigurationSchema.parse({ available: config !== null, publicKey: config?.publicKey ?? null });
}
