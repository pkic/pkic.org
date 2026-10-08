import { webPushNotificationSchema, webPushNotificationDisplay } from "../../../../shared/schemas/event-web-push";
interface PushEvent {
  data: { json(): unknown } | null;
  waitUntil(promise: Promise<unknown>): void;
}
interface NotificationClickEvent {
  notification: { data: unknown; close(): void };
  waitUntil(promise: Promise<unknown>): void;
}
interface PushScope {
  location: { origin: string };
  registration: { showNotification(title: string, options: NotificationOptions): Promise<void> };
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<
      Array<{
        url: string;
        focus(): Promise<unknown>;
        navigate(url: string): Promise<unknown>;
      }>
    >;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "push", handler: (event: PushEvent) => void): void;
  addEventListener(type: "notificationclick", handler: (event: NotificationClickEvent) => void): void;
}
declare const self: PushScope;
self.addEventListener("push", (event) => {
  let raw: unknown;
  try {
    raw = event.data?.json();
  } catch {
    return;
  }
  const checked = webPushNotificationSchema.safeParse(raw);
  if (!checked.success) return;
  const notification = checked.data;
  const display = webPushNotificationDisplay[notification.kind];
  event.waitUntil(
    self.registration.showNotification(display.title, {
      body: display.body,
      icon: "/img/icon-180x180-black-white.png",
      tag: notification.notificationId,
      data: notification,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const checked = webPushNotificationSchema.safeParse(event.notification.data);
  if (!checked.success) return;
  const destination = new URL(checked.data.destination, self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => {
        const url = new URL(client.url);
        return url.origin === self.location.origin && url.pathname === "/portal/";
      });
      if (existing) {
        await existing.navigate(destination.href);
        await existing.focus();
      } else await self.clients.openWindow(destination.href);
    })(),
  );
});
