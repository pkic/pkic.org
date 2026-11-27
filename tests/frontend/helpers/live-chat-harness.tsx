/** One mounted live chat per test, with the dialog host its confirmations open in, removed after each test. */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach } from "vitest";
import type { LiveChatMessage, LiveLocationChatSnapshot } from "../../../assets/shared/schemas/live-session-room";
import { ConfirmDialogHost } from "../../../assets/ts/components/ConfirmDialog";
import {
  applyLocationChatMessage,
  type LiveLocationChatState,
} from "../../../assets/ts/live-session/location-chat-state";
import { liveChatMessage, liveLocationChatSnapshot } from "./live-room-socket";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

export const MESSAGE = "40000000-0000-4000-8000-000000000001";

export function chatMessage(overrides: Partial<LiveChatMessage> = {}): LiveChatMessage {
  return liveChatMessage({ id: MESSAGE, ...overrides });
}

export function stateWith(overrides: Partial<Omit<LiveLocationChatSnapshot, "type">> = {}): LiveLocationChatState {
  const state = applyLocationChatMessage(null, liveLocationChatSnapshot({ chat: [chatMessage()], ...overrides }));
  if (!state) throw new Error("No state");
  return state;
}

export function draw(node: preact.ComponentChild, host: HTMLElement) {
  render(
    <>
      {node}
      <ConfirmDialogHost />
    </>,
    host,
  );
}

export function mount(node: preact.ComponentChild) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => draw(node, host));
  return host;
}

export function typeInto(text: HTMLTextAreaElement, value: string) {
  void act(() => {
    text.value = value;
    text.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function submit(host: HTMLElement) {
  void act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
