import { useEffect, useRef, useState } from "preact/hooks";
import {
  eventWebPushConfigurationSchema,
  eventWebPushStatusSchema,
  webPushSubscriptionSchema,
  eventWebPushRevokeResponseSchema,
} from "../../../../shared/schemas/event-web-push";
import { getJson, postJson, deleteJson } from "../../../shared/api-client";
import { registerPortalServiceWorker } from "../portal-worker-registration";
import { pushDeviceId } from "./push-device";
function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
}
function keyBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const raw = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
async function waitForPortalWorker() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Notification setup timed out. Please try again.")), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function useEventPushNotifications(slug: string) {
  const [state, setState] = useState<"loading" | "unsupported" | "unavailable" | "off" | "on" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState(15);
  const publicKey = useRef<string | null>(null),
    scope = useRef(0);
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/push`;
  useEffect(() => {
    const version = ++scope.current;
    const controller = new AbortController();
    publicKey.current = null;
    setBusy(false);
    setReminderMinutes(15);
    setError("");
    setState("loading");
    if (!supported()) {
      setState("unsupported");
      return;
    }
    void (async () => {
      try {
        const config = await getJson(`${endpoint}/config`, eventWebPushConfigurationSchema, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || version !== scope.current) return;
        if (!config.available || !config.publicKey) {
          setState("unavailable");
          return;
        }
        publicKey.current = config.publicKey;
        const status = await getJson(`${endpoint}/devices/${pushDeviceId()}`, eventWebPushStatusSchema, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted && version === scope.current) {
          setReminderMinutes(status.reminderMinutes);
          setState(status.enabled && status.registered && !status.revoked ? "on" : "off");
        }
      } catch (reason) {
        if (!controller.signal.aborted && version === scope.current) {
          setError(reason instanceof Error ? reason.message : "Unable to load browser notifications.");
          setState("error");
        }
      }
    })();
    return () => {
      controller.abort();
      ++scope.current;
    };
  }, [endpoint, retry]);
  async function enable(reminderMinutes: number) {
    const version = scope.current;
    const configuredKey = publicKey.current;
    if (!configuredKey || !supported() || busy) return;
    setBusy(true);
    setError("");
    let created: PushSubscription | null = null;
    try {
      if ((await Notification.requestPermission()) !== "granted")
        throw new Error("Browser permission was not granted. Email reminders are unchanged.");
      if (version !== scope.current) return;
      const registration = await registerPortalServiceWorker();
      if (!registration) throw new Error("Browser notifications are unavailable.");
      await waitForPortalWorker();
      if (version !== scope.current) return;
      let subscription = await registration.pushManager.getSubscription();
      const applicationServerKey = keyBytes(configuredKey);
      if (subscription) {
        const existing = subscription.options.applicationServerKey;
        if (
          !existing ||
          new Uint8Array(existing).some((byte, index) => byte !== applicationServerKey[index]) ||
          existing.byteLength !== applicationServerKey.byteLength
        )
          throw new Error(
            "This browser has a different notification subscription. Disable its notifications before enabling this event.",
          );
      } else {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        created = subscription;
      }
      if (version !== scope.current) {
        if (created) await created.unsubscribe();
        return;
      }
      const parsed = webPushSubscriptionSchema.parse(subscription.toJSON());
      await postJson(
        `${endpoint}/devices`,
        { deviceId: pushDeviceId(), subscription: parsed, enabled: true, reminderMinutes },
        eventWebPushStatusSchema,
      );
      if (version === scope.current) setState("on");
    } catch (reason) {
      if (created) await created.unsubscribe().catch(() => false);
      if (version === scope.current)
        setError(reason instanceof Error ? reason.message : "Unable to enable browser notifications.");
    } finally {
      if (version === scope.current) setBusy(false);
    }
  }
  async function disable() {
    const version = scope.current;
    setBusy(true);
    setError("");
    try {
      await deleteJson(`${endpoint}/devices/${pushDeviceId()}`, eventWebPushRevokeResponseSchema);
      if (version === scope.current) setState("off");
    } catch (reason) {
      if (version === scope.current)
        setError(reason instanceof Error ? reason.message : "Unable to disable browser notifications.");
    } finally {
      if (version === scope.current) setBusy(false);
    }
  }
  return {
    state,
    busy,
    error,
    enable,
    disable,
    reminderMinutes,
    setReminderMinutes,
    reload: () => setRetry((value) => value + 1),
  };
}
