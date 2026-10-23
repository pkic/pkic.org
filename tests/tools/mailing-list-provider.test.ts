import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGoogleGroupsDeliveryProvider } from "../../functions/_lib/services/google-groups/directory-client";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "reader@example.test",
  GOOGLE_WORKSPACE_ADMIN_EMAIL: "reader@example.test",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const list = "group@example.test";
function google(member: object | null) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "synthetic-token" });
    if (!init?.method) return member ? Response.json(member) : new Response(null, { status: 404 });
    return Response.json({});
  });
}
describe("mailing-list provider adapter", () => {
  it.each(["OWNER", "MANAGER", "UNKNOWN"])("preserves %s privileges discovered after planning", async (role) => {
    const fetch = google({ role, type: "USER" }),
      provider = await createGoogleGroupsDeliveryProvider(env, false, fetch);
    await provider.applyChange(list, { email: "privileged@example.test", action: "unsubscribe" });
    expect(fetch.mock.calls.some(([, request]) => request?.method === "DELETE")).toBe(false);
  });
  it("creates an archive alias with delivery disabled in the same API call", async () => {
    const fetch = google(null),
      provider = await createGoogleGroupsDeliveryProvider(env, false, fetch);
    await provider.applyChange(list, { email: "alias@example.test", action: "subscribe", delivery: "none" });
    const addition = fetch.mock.calls.find(
      ([url, request]) => String(url).includes("/members") && request?.method === "POST",
    )!;
    expect(JSON.parse(String(addition[1]?.body))).toEqual({
      email: "alias@example.test",
      role: "MEMBER",
      delivery_settings: "NONE",
    });
  });
  it("updates existing alias delivery without changing the member role", async () => {
    const fetch = google({ role: "MEMBER", type: "USER", delivery_settings: "ALL_MAIL" }),
      provider = await createGoogleGroupsDeliveryProvider(env, false, fetch);
    await provider.applyChange(list, { email: "alias@example.test", action: "disable_delivery" });
    expect(JSON.parse(String(fetch.mock.calls.find(([, request]) => request?.method === "PATCH")![1]?.body))).toEqual({
      delivery_settings: "NONE",
    });
  });
  it("refuses all provider writes in read-only mode", async () => {
    const fetch = google(null),
      provider = await createGoogleGroupsDeliveryProvider(env, true, fetch);
    await expect(provider.applyChange(list, { email: "alias@example.test", action: "subscribe" })).rejects.toThrow(
      "Dry run",
    );
    expect(fetch.mock.calls).toHaveLength(1);
  });
});
