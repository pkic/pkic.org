import { describe, it, expect } from "vitest";
import { openValue, sealValue, encodeBase64Url } from "../functions/_lib/utils/sealed-value";
import { openProviderJoinUrl, sealProviderJoinUrl } from "../functions/_lib/services/event-series/provider-url";
const secret = "test-only-existing-meeting-secret-at-least32characters";
describe("Purpose-bound versioned protected capability envelopes", () => {
  it("decrypts the pre-extraction meeting envelope byte format", async () => {
    const iv = new Uint8Array(12).fill(7),
      encoder = new TextEncoder(),
      url = "https://meet.example.test/private";
    const material = await crypto.subtle.digest("SHA-256", encoder.encode(`pkic-meeting-provider\0${secret}`));
    const key = await crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(url));
    const old = `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
    expect(await openProviderJoinUrl(old, secret)).toBe(url);
    expect(await openProviderJoinUrl(await sealProviderJoinUrl(url, secret), secret)).toBe(url);
  });
  it("rejects ciphertext moved across owners or domains and authenticated corruption", async () => {
    const value = await sealValue("subscription", secret, "pkic-web-push-subscription", "device:user");
    expect(await openValue(value, secret, "pkic-web-push-subscription", "device:user")).toBe("subscription");
    await expect(openValue(value, secret, "pkic-web-push-subscription", "other:user")).rejects.toThrow();
    await expect(openValue(value, secret, "pkic-meeting-provider", "device:user")).rejects.toThrow();
    await expect(
      openValue(value.slice(0, -2) + "AA", secret, "pkic-web-push-subscription", "device:user"),
    ).rejects.toThrow();
  });
});
