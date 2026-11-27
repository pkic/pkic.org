// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_LIVE_STAGE,
  liveRoomClientMessageSchema,
  type LiveCredit,
  type LiveRoomClientMessage,
} from "../../assets/shared/schemas/live-session-room";
import { LiveSpeakerWelcomeOverlay } from "../../assets/ts/live-session/LiveSpeakerWelcomeOverlay";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { LiveSpeakerWelcomeControls } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveSpeakerWelcomeControls";
import { liveSnapshot, liveTargets } from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

async function draw(node: preact.ComponentChild) {
  const host = document.body.appendChild(document.createElement("div"));
  hosts.push(host);
  await act(() => render(node, host));
  return host;
}

const person = (key: string, name: string, extra: Partial<LiveCredit> = {}): LiveCredit => ({
  key,
  name,
  photoUrl: null,
  moderator: false,
  roleLabel: null,
  titleLine: null,
  identity: { title: "Architect", organization: "Example Trust" },
  additionalIdentities: [],
  ...extra,
});

const SESSION = {
  ...liveSnapshot().session,
  title: "Migrating a national PKI",
  eventName: "Sample Conference",
  startAt: "2026-11-30T09:30:00.000Z",
  timeZone: "Europe/Amsterdam",
  sessionType: "Panel discussion",
};

const names = (host: HTMLElement) =>
  [...host.querySelectorAll(".pk-live-welcome__name")].map((name) => name.textContent);

describe("the speaker welcome", () => {
  it("greets one speaker from their identity with the session's type, local start time and title, and no logo", async () => {
    const host = await draw(
      <LiveSpeakerWelcomeOverlay session={{ ...SESSION, credits: [person("user:a", "Pat Example")] }} />,
    );
    expect(host.querySelector(".pk-live-welcome__event")?.textContent).toBe("Sample Conference");
    expect(host.querySelector(".pk-live-welcome__eyebrow")?.textContent).toBe("Please welcome");
    expect(names(host)).toEqual(["Pat Example"]);
    expect(host.querySelector(".pk-live-welcome__title")?.textContent).toBe("Architect");
    expect(host.querySelector(".pk-live-welcome__organization")?.textContent).toBe("Example Trust");
    // 09:30 UTC is 10:30 in Amsterdam.
    expect(host.querySelector(".pk-live-welcome__when")?.textContent).toBe("Panel discussion · 10:30");
    expect(host.querySelector(".pk-live-welcome__session")?.textContent).toBe("Migrating a national PKI");
    expect(host.querySelector(".pk-live-welcome__portrait")).not.toBeNull();
    expect(host.querySelector("svg")).toBeNull();
  });

  it("welcomes the speakers then the moderator, never the hosts, and at most six", async () => {
    const credits = [
      person("user:mod", "Mo Moderator", { moderator: true, roleLabel: "Moderator" }),
      person("host:mc", "Hana Host", { roleLabel: "Master of ceremonies", identity: null }),
      ...Array.from({ length: 6 }, (_, index) => person(`user:${index}`, `Speaker ${index}`)),
    ];
    const host = await draw(<LiveSpeakerWelcomeOverlay session={{ ...SESSION, credits }} />);
    expect(host.querySelector("[data-arrangement]")?.getAttribute("data-arrangement")).toBe("grid");
    expect(names(host)).toEqual(["Speaker 0", "Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4", "Speaker 5"]);
    const panel = await draw(<LiveSpeakerWelcomeOverlay session={{ ...SESSION, credits: credits.slice(0, 4) }} />);
    expect(names(panel)).toEqual(["Speaker 0", "Speaker 1", "Mo Moderator"]);
    expect(panel.querySelectorAll(".pk-live-welcome__role")).toHaveLength(1);
  });

  it("sets a very long name with the given name large and the rest under it, and draws nothing without speakers", async () => {
    const host = await draw(
      <LiveSpeakerWelcomeOverlay
        session={{ ...SESSION, credits: [person("user:a", "Alexandra van Placeholder-Smith")] }}
      />,
    );
    expect(host.querySelector(".pk-live-welcome__name")?.getAttribute("data-fit")).toBe("split");
    expect(host.querySelector(".pk-live-welcome__given")?.textContent).toBe("Alexandra");
    expect(host.querySelector(".pk-live-welcome__family")?.textContent).toBe("van Placeholder-Smith");
    const empty = await draw(<LiveSpeakerWelcomeOverlay session={{ ...SESSION, credits: [] }} />);
    expect(empty.textContent).toBe("");
  });

  it("is drawn on Program's full frame only while it is on, on the Full board background", async () => {
    const state = applyLiveRoomMessage(null, liveSnapshot())!;
    const off = await draw(
      <LiveOverlayPresentation view="program" layout="full-board" projection={{ ...state, stage: EMPTY_LIVE_STAGE }} />,
    );
    expect(off.querySelector(".pk-live-welcome")).toBeNull();
    const on = await draw(
      <LiveOverlayPresentation
        view="program"
        layout="full-board"
        projection={{ ...state, stage: { ...EMPTY_LIVE_STAGE, speakerWelcome: true } }}
      />,
    );
    expect(on.querySelector('[data-overlay-element="speakerWelcome"] .pk-live-welcome')).not.toBeNull();
    expect(on.querySelector('[data-overlay-element="background"]')).not.toBeNull();
  });

  it("is switched from its studio row on Preview and on air", async () => {
    const state = applyLiveRoomMessage(null, liveSnapshot())!;
    const sendProgram = vi.fn((_message: LiveRoomClientMessage) => true);
    const host = await draw(<LiveSpeakerWelcomeControls targets={liveTargets(state, { sendProgram })} />);
    expect(host.textContent).toContain("Sam Speaker");
    host.querySelector<HTMLButtonElement>('button[aria-label="Show speaker welcome in preview"]')!.click();
    host.querySelector<HTMLButtonElement>('button[aria-label="Show speaker welcome on air"]')!.click();
    const [preview, program] = sendProgram.mock.calls.map(([message]) => liveRoomClientMessageSchema.parse(message));
    expect(preview).toEqual({ type: "preview.set", composition: { speakerWelcome: true } });
    expect(program).toMatchObject({ type: "stage.set", speakerWelcome: true });
  });
});
