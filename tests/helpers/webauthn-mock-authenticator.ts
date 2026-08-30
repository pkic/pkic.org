/**
 * Mock WebAuthn authenticator for tests/passkeys.test.ts.
 *
 * Real registration/authentication ceremonies can't be reproduced in a unit
 * test without a real authenticator, so this hand-builds the same byte
 * layouts a real one would produce — a P-256 keypair, a CBOR "none"
 * attestation object for registration, and a signed assertion for
 * authentication — using @simplewebauthn/server's own low-level helpers
 * (COSE/CBOR/base64url) so the encoding matches exactly what
 * verifyRegistrationResponse/verifyAuthenticationResponse expect.
 */
import { isoBase64URL, isoCBOR, isoUint8Array } from "@simplewebauthn/server/helpers";

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * This project's lib/types config makes `crypto.subtle.*`/`TextEncoder`
 * results type as `Uint8Array<ArrayBufferLike>`, while
 * @simplewebauthn/server's `Uint8Array_` alias resolves to
 * `Uint8Array<ArrayBuffer>` — same bytes, stricter generic. Re-wrapping via
 * the array-like constructor overload always allocates a fresh
 * `Uint8Array<ArrayBuffer>`, satisfying both.
 */
function bytes(source: ArrayBuffer | Uint8Array): Bytes {
  return new Uint8Array(Array.from(new Uint8Array(source))) as Bytes;
}

function encodeUtf8(value: string): Bytes {
  return bytes(new TextEncoder().encode(value));
}

/** The CBOR value type isoCBOR.encode expects, without importing tiny-cbor's own (transitive, not directly resolvable under pnpm) `CBORType` export by name. */
type CBORInput = Parameters<typeof isoCBOR.encode>[0];

export interface MockAuthenticator {
  credentialId: Bytes;
  privateKey: CryptoKey;
  publicKeyCose: Bytes;
  aaguid: Bytes;
}

async function sha256(data: Bytes): Promise<Bytes> {
  return bytes(await crypto.subtle.digest("SHA-256", data));
}

function u32be(n: number): Bytes {
  const buf = new Uint8Array(4) as Bytes;
  new DataView(buf.buffer).setUint32(0, n, false);
  return buf;
}

function u16be(n: number): Bytes {
  const buf = new Uint8Array(2) as Bytes;
  new DataView(buf.buffer).setUint16(0, n, false);
  return buf;
}

export async function createMockAuthenticator(): Promise<MockAuthenticator> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rawPublicKey = bytes(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  // Uncompressed EC point: 0x04 || x(32) || y(32).
  const x = rawPublicKey.slice(1, 33);
  const y = rawPublicKey.slice(33, 65);

  // COSE_Key map for an ES256 EC2 key: kty=EC2(2), alg=ES256(-7), crv=P-256(1).
  const publicKeyCose = bytes(
    isoCBOR.encode(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]) as CBORInput,
    ),
  );

  const credentialId = bytes(crypto.getRandomValues(new Uint8Array(32)));
  const aaguid = new Uint8Array(16) as Bytes;

  return { credentialId, privateKey: keyPair.privateKey, publicKeyCose, aaguid };
}

/**
 * DER-encode a raw ECDSA r||s signature (what Web Crypto's `subtle.sign`
 * returns) into the ASN.1 SEQUENCE{INTEGER, INTEGER} form WebAuthn requires.
 */
function derFromRawSignature(raw: Bytes): Bytes {
  const encodeInt = (component: Bytes): Bytes => {
    let component_ = component;
    let start = 0;
    while (start < component_.length - 1 && component_[start] === 0 && (component_[start + 1] & 0x80) === 0) {
      start += 1;
    }
    component_ = component_.slice(start);
    if (component_[0] & 0x80) {
      const padded = new Uint8Array(component_.length + 1) as Bytes;
      padded.set(component_, 1);
      component_ = padded;
    }
    return bytes(isoUint8Array.concat([new Uint8Array([0x02, component_.length]) as Bytes, component_]));
  };

  const rEncoded = encodeInt(raw.slice(0, 32));
  const sEncoded = encodeInt(raw.slice(32, 64));
  const body = bytes(isoUint8Array.concat([rEncoded, sEncoded]));
  return bytes(isoUint8Array.concat([new Uint8Array([0x30, body.length]) as Bytes, body]));
}

interface MockRegistrationResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports: string[];
  };
  clientExtensionResults: Record<string, unknown>;
  type: "public-key";
}

export async function buildRegistrationResponse(
  authenticator: MockAuthenticator,
  opts: { challenge: string; rpId: string; origin: string; userVerified?: boolean },
): Promise<MockRegistrationResponse> {
  const rpIdHash = await sha256(encodeUtf8(opts.rpId));
  const flags = new Uint8Array([opts.userVerified === false ? 0x41 : 0x45]) as Bytes; // UP | AT, optionally UV
  const authData = bytes(
    isoUint8Array.concat([
      rpIdHash,
      flags,
      u32be(0),
      authenticator.aaguid,
      u16be(authenticator.credentialId.length),
      authenticator.credentialId,
      authenticator.publicKeyCose,
    ]),
  );

  const attestationObject = bytes(
    isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]) as CBORInput,
    ),
  );

  const clientDataJSON = encodeUtf8(
    JSON.stringify({ type: "webauthn.create", challenge: opts.challenge, origin: opts.origin }),
  );

  return {
    id: isoBase64URL.fromBuffer(authenticator.credentialId),
    rawId: isoBase64URL.fromBuffer(authenticator.credentialId),
    response: {
      clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
      attestationObject: isoBase64URL.fromBuffer(attestationObject),
      transports: ["internal"],
    },
    clientExtensionResults: {},
    type: "public-key",
  };
}

interface MockAuthenticationResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: Record<string, unknown>;
  type: "public-key";
}

export async function buildAuthenticationResponse(
  authenticator: MockAuthenticator,
  opts: {
    challenge: string;
    rpId: string;
    origin: string;
    signCount: number;
    userHandle?: Bytes;
    userVerified?: boolean;
  },
): Promise<MockAuthenticationResponse> {
  const rpIdHash = await sha256(encodeUtf8(opts.rpId));
  const flags = new Uint8Array([opts.userVerified === false ? 0x01 : 0x05]) as Bytes; // UP, optionally UV
  const authenticatorData = bytes(isoUint8Array.concat([rpIdHash, flags, u32be(opts.signCount)]));

  const clientDataJSON = encodeUtf8(
    JSON.stringify({ type: "webauthn.get", challenge: opts.challenge, origin: opts.origin }),
  );
  const clientDataHash = await sha256(clientDataJSON);

  const dataToSign = bytes(isoUint8Array.concat([authenticatorData, clientDataHash]));
  const rawSignature = bytes(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, authenticator.privateKey, dataToSign),
  );
  const signature = derFromRawSignature(rawSignature);

  return {
    id: isoBase64URL.fromBuffer(authenticator.credentialId),
    rawId: isoBase64URL.fromBuffer(authenticator.credentialId),
    response: {
      clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
      authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
      signature: isoBase64URL.fromBuffer(signature),
      ...(opts.userHandle ? { userHandle: isoBase64URL.fromBuffer(opts.userHandle) } : {}),
    },
    clientExtensionResults: {},
    type: "public-key",
  };
}
