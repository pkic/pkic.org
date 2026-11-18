// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import {
  STUDIO_PHONE_VIEWS,
  StudioPhone,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/StudioPhone";
import { LIVE_QUESTION, liveSnapshot } from "./helpers/live-room-socket";

/** A room in Q&A with a question on air: a board the Default scene never draws. */
const room = applyLiveRoomMessage(
  null,
  liveSnapshot({
    viewer: { role: "operator", name: "Olga Operator" },
    stage: {
      ...liveSnapshot().stage,
      scene: "questions",
      question: {
        id: LIVE_QUESTION,
        text: "What about hybrid certificates?",
        authorName: null,
        authorPhotoUrl: null,
        authorAffiliation: null,
        addressedTo: null,
      },
    },
  }),
)!;
const sources = {
  preview: room,
  program: room,
  agenda: null,
  connected: true,
  slug: "pqc-2026",
  roomId: "room",
  startAt: room.session.startAt,
};

const hosts: HTMLElement[] = [];
function mount(onScene = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  act(() => {
    render(
      <StudioPhone
        state={room}
        sources={sources}
        clock="UTC"
        active
        transition={null}
        disabled={false}
        onClear={vi.fn()}
        onScene={onScene}
        notice={null}
        home={null}
        panel={(type) => ({ title: type, body: null })}
      />,
      host,
    );
  });
  return { host, onScene };
}
const drawn = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>("[data-overlay-element]")].map((each) => each.dataset.overlayElement);
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.getAttribute("aria-label") === name)!;

afterEach(() => {
  for (const host of hosts.splice(0)) {
    act(() => render(null, host));
    host.remove();
  }
});

describe("the studio on a phone", () => {
  it("draws the large view of an output in the scene its thumbnail shows", () => {
    const { host } = mount();
    const thumbnail = host.querySelector<HTMLElement>('.pk-studio-phone__thumb[data-tally="program"]')!;
    expect(drawn(thumbnail)).toContain("question");
    act(() => {
      button("Program").click();
    });
    act(() => {
      button("Full screen Program").click();
    });
    const large = document.querySelector<HTMLElement>(".pk-studio-monitor__viewer .pk-studio-monitor__screen")!;
    expect(drawn(large)).toEqual(drawn(thumbnail));
  });

  it("names each output's scene under its picture, and loads another into Preview from there", () => {
    const { host, onScene } = mount();
    const program = host.querySelector<HTMLElement>('.pk-studio-phone__thumb[data-tally="program"]')!;
    expect(program.querySelector(".pk-studio-phone__thumb-scene")?.textContent).toBe("Q&A");
    act(() => {
      button("Scene in Preview: Q&A").click();
    });
    const scenes = document.querySelector<HTMLElement>(".pk-studio-scene-popover")!;
    const names = [...scenes.querySelectorAll(".pk-studio-scene__name")].map((each) => each.textContent);
    expect(names).toEqual(["Default", "Q&A", "Panel", "Break", "Check-in", "Full board"]);
    act(() => {
      [...scenes.querySelectorAll("button")].find((each) => each.textContent?.includes("Break"))!.click();
    });
    expect(onScene).toHaveBeenCalledWith("break");
  });

  it("reaches polls and chat as views of their own", () => {
    expect(STUDIO_PHONE_VIEWS).toEqual(expect.arrayContaining(["polls", "chat"]));
  });
});
