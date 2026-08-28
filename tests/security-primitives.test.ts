import { describe, expect, it } from "vitest";
import { getSessionCookieToken, parseCookieHeader } from "../functions/_lib/auth/session-engine";
import { generateSignedBounceAddress, verifySignedBounceAddress } from "../functions/_lib/email/bounces";
import { generateSignedRsvpAddress, verifySignedRsvpAddressFull } from "../functions/_lib/email/rsvp";
import { parseTaggedInboundAddress } from "../functions/_lib/email/tagged-address";
import { readBoundedStream } from "../functions/_lib/utils/bounded-stream";
import { hmacSha256Bytes, hmacSha256Hex } from "../functions/_lib/utils/crypto";
import { detectImageFormat, resolveImageAttachmentFormat } from "../functions/_lib/utils/image-format";
import { signJwt, verifyJwt } from "../functions/_lib/utils/jwt";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe("shared cookie parsing", () => {
  it("decodes valid values while ignoring a malformed pair instead of throwing", () => {
    expect(parseCookieHeader("broken=%E0%A4%A; valid=session%2Etoken; plain=value")).toEqual(
      new Map([
        ["valid", "session.token"],
        ["plain", "value"],
      ]),
    );

    const request = new Request("https://app.test", {
      headers: { cookie: "noise=%; pkic_session=valid%2Etoken" },
    });
    expect(getSessionCookieToken(request, "pkic_session")).toBe("valid.token");
    expect(getSessionCookieToken(request, "noise")).toBeNull();
  });
});

describe("shared HMAC bytes", () => {
  it("matches a standard SHA-256 HMAC vector and the hexadecimal adapter", async () => {
    const expected = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
    const bytes = await hmacSha256Bytes("key", "The quick brown fox jumps over the lazy dog");
    expect([...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")).toBe(expected);
    await expect(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).resolves.toBe(expected);
  });

  it("keeps JWT signing valid while rejecting tampered, malformed, and expired tokens", async () => {
    const token = await signJwt("jwt-secret", { sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60 });
    await expect(verifyJwt<{ sub: string; exp: number }>("jwt-secret", token)).resolves.toMatchObject({
      ok: true,
      claims: { sub: "user-1" },
    });

    const [header, payload, signature] = token.split(".");
    const replacement = signature.endsWith("A") ? "B" : "A";
    await expect(
      verifyJwt("jwt-secret", `${header}.${payload}.${signature.slice(0, -1)}${replacement}`),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    await expect(verifyJwt("jwt-secret", "not-a-jwt")).resolves.toEqual({ ok: false, reason: "invalid" });

    const expired = await signJwt("jwt-secret", { sub: "user-1", exp: Math.floor(Date.now() / 1000) - 1 });
    await expect(verifyJwt("jwt-secret", expired)).resolves.toEqual({ ok: false, reason: "expired" });
  });
});

describe("tagged inbound email addresses", () => {
  const secret = "inbound-secret";
  const registrationId = "12345678-1234-4abc-8def-1234567890ab";

  it("extracts only a non-empty tag for the configured base mailbox", () => {
    expect(parseTaggedInboundAddress("Mail.Box+signed-tag@EXAMPLE.test", "mail.box+old@example.TEST")).toEqual({
      baseLocal: "mail.box",
      domain: "example.TEST",
      tag: "signed-tag",
    });
    expect(parseTaggedInboundAddress("mail.box@example.test", "mail.box@example.test")).toBeNull();
    expect(parseTaggedInboundAddress("mail.box+tag@example.test@evil.test", "mail.box@example.test")).toBeNull();
    expect(parseTaggedInboundAddress("mail.box+tag@evil.test", "mail.box@example.test")).toBeNull();
  });

  it("round-trips bounce addresses with tagged and regex-significant base locals", async () => {
    const address = await generateSignedBounceAddress(registrationId, secret, "bounces.test+old@mail.example");
    const [local, domain] = address.split("@");
    const tag = local.slice("bounces.test+".length);
    await expect(
      verifySignedBounceAddress(`BOUNCES.TEST+${tag}@${domain.toUpperCase()}`, secret, "bounces.test@mail.example"),
    ).resolves.toBe(registrationId);
    const tamperedTag = `${tag.slice(0, -1)}${tag.endsWith("0") ? "1" : "0"}`;
    const tampered = `bounces.test+${tamperedTag}@${domain}`;
    await expect(verifySignedBounceAddress(tampered, secret, "bounces.test+old@mail.example")).resolves.toBeNull();
    await expect(
      verifySignedBounceAddress(`${address}@evil.test`, secret, "bounces.test@mail.example"),
    ).resolves.toBeNull();
  });

  it("round-trips single-day and per-day RSVP addresses and rejects a modified MAC", async () => {
    const base = "rsvp.test+old@mail.example";
    const single = await generateSignedRsvpAddress(registrationId, secret, base);
    await expect(verifySignedRsvpAddressFull(single, secret, base)).resolves.toEqual({
      registrationId,
      dayDate: null,
    });

    const perDay = await generateSignedRsvpAddress(registrationId, secret, base, "2026-08-21");
    const perDayTag = perDay.slice("rsvp.test+".length, perDay.lastIndexOf("@"));
    await expect(
      verifySignedRsvpAddressFull(`RSVP.TEST+${perDayTag}@MAIL.EXAMPLE`, secret, "rsvp.test@mail.example"),
    ).resolves.toEqual({ registrationId, dayDate: "2026-08-21" });
    const [local, domain] = perDay.split("@");
    const tamperedLocal = `${local.slice(0, -1)}${local.endsWith("A") ? "B" : "A"}`;
    await expect(verifySignedRsvpAddressFull(`${tamperedLocal}@${domain}`, secret, base)).resolves.toBeNull();
  });

  it("rejects malformed bases and preserves the local-part length boundary", async () => {
    await expect(generateSignedBounceAddress(registrationId, secret, "missing-domain")).rejects.toThrow(
      "Invalid base email",
    );
    await expect(generateSignedRsvpAddress(registrationId, secret, "a@b@c")).rejects.toThrow("Invalid base email");
    await expect(generateSignedBounceAddress(registrationId, secret, `${"a".repeat(17)}@example.test`)).rejects.toThrow(
      "max allowed is 16",
    );
  });
});

describe("shared image format detection", () => {
  it("detects every supported signature at its minimum boundary", () => {
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff]))).toEqual({
      contentType: "image/jpeg",
      extension: "jpg",
    });
    expect(detectImageFormat(PNG_BYTES)).toEqual({ contentType: "image/png", extension: "png" });
    expect(detectImageFormat(WEBP_BYTES)).toEqual({ contentType: "image/webp", extension: "webp" });
    expect(detectImageFormat(PNG_BYTES.slice(0, 7))).toBeNull();
    expect(detectImageFormat(WEBP_BYTES.slice(0, 11))).toBeNull();
  });

  it("lets real attachment bytes override declared metadata and retains the legacy fallback", () => {
    expect(resolveImageAttachmentFormat("image/png", new Uint8Array([0xff, 0xd8, 0xff]))).toEqual({
      contentType: "image/jpeg",
      extension: "jpg",
    });
    expect(resolveImageAttachmentFormat("image/webp; charset=binary", new Uint8Array([0x00]))).toEqual({
      contentType: "image/webp",
      extension: "webp",
    });
    expect(resolveImageAttachmentFormat("application/octet-stream", new Uint8Array())).toEqual({
      contentType: "image/jpeg",
      extension: "jpg",
    });
  });
});

describe("bounded stream reader", () => {
  it("accepts an exact-size multi-chunk body and an empty stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    await expect(readBoundedStream(stream, 3)).resolves.toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    await expect(readBoundedStream(null, 1)).resolves.toEqual({ ok: true, bytes: new Uint8Array() });
  });

  it("cancels at the first oversized chunk and tolerates cancellation failure", async () => {
    let cancelReason: unknown;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel(reason) {
        cancelReason = reason;
        throw new Error("cancel failed");
      },
    });
    await expect(readBoundedStream(stream, 2, "bounded test")).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(cancelReason).toBe("bounded test");
  });

  it("rejects invalid byte limits before consuming the stream", async () => {
    await expect(readBoundedStream(null, 0)).rejects.toThrow("maxBytes must be a positive safe integer");
    await expect(readBoundedStream(null, Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow(
      "maxBytes must be a positive safe integer",
    );
  });
});
