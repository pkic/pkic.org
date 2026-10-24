import { expect, type Page } from "@playwright/test";
import {
  LIVE_ROOM_PROTOCOL,
  liveRoomClientMessageSchema,
  liveRoomServerMessageSchema,
  type LiveRoomClientMessage,
} from "../../../assets/shared/schemas/live-session-room";

interface BrowserLiveProbe {
  socket: WebSocket;
  messages: string[];
  close: { code: number; reason: string } | null;
}
declare global {
  var liveSessionBrowserProbe: BrowserLiveProbe | undefined;
}

/** Native browser WebSocket, with the page's actual cookie and Origin; no intercepted delivery. */
export async function connectLiveBrowser(page: Page, path: string) {
  await page.evaluate(
    ({ path, protocol }) => {
      const url = new URL(path, location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url, protocol);
      const probe: BrowserLiveProbe = { socket, messages: [], close: null };
      globalThis.liveSessionBrowserProbe = probe;
      socket.addEventListener("message", (event) => probe.messages.push(String(event.data)));
      socket.addEventListener("close", (event) => {
        probe.close = { code: event.code, reason: event.reason };
      });
    },
    { path, protocol: LIVE_ROOM_PROTOCOL },
  );
}
export async function liveMessages(page: Page) {
  const raw = await page.evaluate(() => {
    const probe = globalThis.liveSessionBrowserProbe;
    if (!probe) throw new Error("Live browser probe is not connected");
    return probe.messages;
  });
  return raw.map((message) => liveRoomServerMessageSchema.parse(JSON.parse(message)));
}
export async function liveClose(page: Page) {
  return page.evaluate(() => {
    const probe = globalThis.liveSessionBrowserProbe;
    if (!probe) throw new Error("Live browser probe is not connected");
    return probe.close;
  });
}
export async function sendLiveMessage(page: Page, message: LiveRoomClientMessage) {
  const parsed = liveRoomClientMessageSchema.parse(message);
  await page.evaluate((message) => {
    const probe = globalThis.liveSessionBrowserProbe;
    if (!probe) throw new Error("Live browser probe is not connected");
    probe.socket.send(JSON.stringify(message));
  }, parsed);
}
export async function expectLiveOperator(page: Page) {
  await expect
    .poll(async () =>
      (await liveMessages(page)).some(
        (message) => message.type === "room.snapshot" && message.viewer.role === "operator",
      ),
    )
    .toBe(true);
}

/** Advisory browser-observed latency includes the native socket round trip and durable room acknowledgment. */
export async function measureLiveChatDelivery(page: Page, text: string): Promise<number> {
  const command = liveRoomClientMessageSchema.parse({ type: "chat.send", text });
  if (command.type !== "chat.send") throw new Error("Expected a chat send command");
  const result = await page.evaluate(
    (command) =>
      new Promise<{ milliseconds: number; raw: string }>((resolve, reject) => {
        const probe = globalThis.liveSessionBrowserProbe;
        if (!probe || probe.socket.readyState !== WebSocket.OPEN)
          throw new Error("Live browser probe is not connected");
        const started = performance.now();
        const timer = setTimeout(() => {
          probe.socket.removeEventListener("message", receive);
          reject(new Error("Persisted chat acknowledgment did not arrive"));
        }, 10_000);
        function receive(event: MessageEvent) {
          const raw = String(event.data),
            message = JSON.parse(raw);
          if (message.type !== "chat.message" || message.message.text !== command.text) return;
          clearTimeout(timer);
          probe!.socket.removeEventListener("message", receive);
          resolve({ milliseconds: performance.now() - started, raw });
        }
        probe.socket.addEventListener("message", receive);
        probe.socket.send(JSON.stringify(command));
      }),
    command,
  );
  const delivered = liveRoomServerMessageSchema.parse(JSON.parse(result.raw));
  expect(delivered).toMatchObject({ type: "chat.message", message: { text } });
  return result.milliseconds;
}
