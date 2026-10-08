import { beforeEach, afterEach, expect, it, vi } from "vitest";
const remove = vi.hoisted(() => vi.fn());
vi.mock("../../assets/ts/shared/api-client", async (original) => ({ ...(await original()), deleteJson: remove }));
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { revokePushDevice } from "../../assets/ts/member-flows/portal/notifications/revokePushDevice";
import { pushDeviceId, existingPushDeviceId } from "../../assets/ts/member-flows/portal/notifications/push-device";
let unsubscribe: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  remove.mockReset().mockResolvedValue({ revoked: true });
  unsubscribe = vi.fn(async () => true);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: vi.fn(async () => ({ pushManager: { getSubscription: vi.fn(async () => ({ unsubscribe })) } })),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("does nothing for a browser that never enabled notifications", async () => {
  await revokePushDevice();
  expect(remove).not.toHaveBeenCalled();
  expect(unsubscribe).not.toHaveBeenCalled();
});
it("revokes all event consent before browser unsubscribe and forgets the opaque ID", async () => {
  const id = pushDeviceId();
  const order: string[] = [];
  remove.mockImplementation(async () => {
    order.push("server");
    return { revoked: true };
  });
  unsubscribe.mockImplementation(async () => {
    order.push("browser");
    return true;
  });
  await revokePushDevice();
  expect(remove).toHaveBeenCalledWith(`/api/v1/users/current/push/devices/${id}`, expect.anything());
  expect(order).toEqual(["server", "browser"]);
  expect(existingPushDeviceId()).toBeNull();
});
it("retains a retry path if server revocation fails", async () => {
  const id = pushDeviceId();
  remove.mockRejectedValue(new Error("Connection lost"));
  await expect(revokePushDevice()).rejects.toThrow("Connection lost");
  expect(existingPushDeviceId()).toBe(id);
  expect(unsubscribe).not.toHaveBeenCalled();
});
it("retains a retry path if browser unsubscribe fails", async () => {
  const id = pushDeviceId();
  unsubscribe.mockResolvedValue(false);
  await expect(revokePushDevice()).rejects.toThrow("cleanup failed");
  expect(existingPushDeviceId()).toBe(id);
});
it("does not revoke another account's stale device and removes its local subscription", async () => {
  pushDeviceId();
  remove.mockRejectedValue(
    new ApiClientError({ error: { code: "PUSH_DEVICE_OWNER_REQUIRED", message: "Different owner" } }, 403),
  );
  await revokePushDevice();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(existingPushDeviceId()).toBeNull();
});
