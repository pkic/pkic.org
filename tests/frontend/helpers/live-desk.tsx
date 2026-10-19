// The live control room desk on a fake room socket, for the studio's component tests.
import { render } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";
import { LiveSessionDesk } from "../../../assets/ts/member-flows/portal/sections/events/detail/live/LiveSessionDesk";
import { fakeLiveSockets, LIVE_OCCURRENCE, liveSnapshot } from "./live-room-socket";

const hosts: HTMLElement[] = [];
export const OPERATOR = { role: "operator" as const, name: "Olga Operator" };

/** Mounts the desk on a fake room socket that has not opened yet. */
export function mountClosedDesk() {
  const live = fakeLiveSockets();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => {
    render(
      <LiveSessionDesk
        slug="pqc-2026"
        occurrenceId={LIVE_OCCURRENCE}
        activeOccurrenceId={LIVE_OCCURRENCE}
        createSocket={live.factory}
      />,
      host,
    );
  });
  return { host, live };
}

/** Mounts the desk in a workspace and delivers the room's snapshot. */
export function mountDesk(snapshot = liveSnapshot({ viewer: OPERATOR }), workspace = "show") {
  history.replaceState(null, "", workspace === "show" ? "/#/live" : `/#/live?studio=${workspace}`);
  const desk = mountClosedDesk();
  void act(() => {
    desk.live.latest().open();
    desk.live.latest().deliver(snapshot);
  });
  return desk;
}

export function button(host: ParentNode, name: string) {
  const found = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

export function labeled(host: ParentNode, name: string) {
  const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!found) throw new Error(`No button labeled ${name}`);
  return found;
}

/** What the desk asked the room to do; presence travels alongside as the operator moves. */
export function commands(live: ReturnType<typeof fakeLiveSockets>) {
  return live
    .latest()
    .messages()
    .filter((message) => message.type !== "presence.update");
}

/** The Transition control's button, which replaces Program with the preview. */
export function take(host: HTMLElement) {
  const found = host.querySelector<HTMLButtonElement>('.pk-studio-transition button[aria-label="Transition"]');
  if (!found) throw new Error("No Transition button");
  return found;
}

export function panel(host: HTMLElement, label: string) {
  const found = host.querySelector<HTMLElement>(`section[aria-label="${label}"]`);
  if (!found) throw new Error(`No panel ${label}`);
  return found;
}

export function type(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  void act(() => {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Starts each test without a saved studio arrangement. */
export function resetDeskStorage() {
  try {
    localStorage.clear();
  } catch {
    // Storage may be unavailable; the defaults apply.
  }
}

/** Unmounts every desk a test mounted. */
export function unmountDesks() {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
}
