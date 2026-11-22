import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach } from "vitest";
import { ConfirmDialogHost } from "../../../assets/ts/components/ConfirmDialog";
import { SessionQuestions } from "../../../assets/ts/live-session/SessionQuestions";
import { fakeLiveSockets, LIVE_OCCURRENCE, liveSnapshot } from "./live-room-socket";

/** A session's Questions section on a fake room socket, unmounted after each test. */
const hosts: HTMLElement[] = [];

export function mount(window = { startOffsetMinutes: -10, durationMinutes: 60 }) {
  const live = fakeLiveSockets();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const startAt = new Date(Date.now() + window.startOffsetMinutes * 60_000).toISOString();
  const endAt = new Date(Date.parse(startAt) + window.durationMinutes * 60_000).toISOString();
  void act(() => {
    render(
      <>
        <SessionQuestions
          slug="pqc-2026"
          occurrenceId={LIVE_OCCURRENCE}
          startAt={startAt}
          endAt={endAt}
          createSocket={live.factory}
        />
        <ConfirmDialogHost />
      </>,
      host,
    );
  });
  return { host, live };
}

export function connect(live: ReturnType<typeof fakeLiveSockets>, snapshot = liveSnapshot()) {
  void act(() => {
    live.latest().open();
    live.latest().deliver(snapshot);
  });
}

export const openAsk = (host: HTMLElement) => void act(() => button(host, "Ask a question").click());

export function button(host: HTMLElement, name: string) {
  const found = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});
