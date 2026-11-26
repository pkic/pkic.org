// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import { LiveStillPictures } from "../../assets/ts/live-session/live-still-pictures";
import {
  STUDIO_PHONE_VIEWS,
  StudioPhone,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/StudioPhone";
import { LIVE_QUESTION, liveSnapshot } from "./helpers/live-room-socket";

/** A room in Board right with a question on air: a board that sits in the scene's column. */
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
function mount(onScene = vi.fn(), eventPath?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => {
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
        eventPath={eventPath}
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

beforeEach(() => {
  // jsdom has no modal dialogs; the More sheet opens one.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
});

describe("a still picture of an output", () => {
  it("cuts a lower third on and off at once, where a moving picture plays it out", () => {
    const credit = room.session.credits[0]!;
    const withLowerThird = {
      ...room,
      stage: { ...room.stage, lowerThird: credit, lowerThirdMotion: "animated" as const },
    };
    const graphic = (host: HTMLElement) => host.querySelector<HTMLElement>(".pk-live-overlay__lower-third-graphic");
    const draw = (host: HTMLElement, still: boolean, projection: typeof room) =>
      void act(() =>
        render(
          <LiveStillPictures.Provider value={still}>
            <LiveOverlayPresentation view="program" projection={projection} eventSlug="pqc-2026" />
          </LiveStillPictures.Provider>,
          host,
        ),
      );
    const [still, moving] = [document.createElement("div"), document.createElement("div")];
    document.body.append(still, moving);
    hosts.push(still, moving);
    for (const host of [still, moving]) draw(host, host === still, withLowerThird);
    for (const host of [still, moving]) draw(host, host === still, room);
    // The still picture has nothing to wait for; the moving one is on its way out.
    expect(graphic(still)).toBeNull();
    expect(graphic(moving)?.dataset.phase).toBe("exiting");
  });
});

describe("the studio on a phone", () => {
  it("draws the large view of an output in the scene its thumbnail shows", () => {
    const { host } = mount();
    const thumbnail = host.querySelector<HTMLElement>('.pk-studio-phone__thumb[data-tally="program"]')!;
    expect(drawn(thumbnail)).toContain("question");
    void act(() => {
      button("Program").click();
    });
    void act(() => {
      button("Full screen Program").click();
    });
    const large = document.querySelector<HTMLElement>(".pk-studio-monitor__viewer .pk-studio-monitor__screen")!;
    expect(drawn(large)).toEqual(drawn(thumbnail));
  });

  it("names each output's scene under its picture, and loads another into Preview from the picture's tools", () => {
    const { host, onScene } = mount();
    const scene = (tally: string) =>
      host.querySelector(`.pk-studio-phone__thumb[data-tally="${tally}"] .pk-studio-phone__thumb-scene`);
    expect([scene("preview")?.textContent, scene("program")?.textContent]).toEqual([
      "PVWBoard right",
      "PGMBoard right",
    ]);
    // The scene is a name, not a control, until the picture is touched; Program offers no scenes at all.
    expect(scene("preview")?.querySelector("button")).toBeNull();
    void act(() => {
      button("Program").click();
    });
    expect(button("Scene in Preview: Board right")).toBeUndefined();
    void act(() => {
      button("Preview").click();
    });
    void act(() => {
      button("Scene in Preview: Board right").click();
    });
    const scenes = document.querySelector<HTMLElement>(".pk-studio-scene-popover")!;
    const names = [...scenes.querySelectorAll(".pk-studio-scene__name")].map((each) => each.textContent);
    expect(names).toEqual(["Camera", "Board right", "Board left", "Full board", "Break"]);
    void act(() => {
      [...scenes.querySelectorAll("button")].find((each) => each.textContent?.includes("Break"))!.click();
    });
    expect(onScene).toHaveBeenCalledWith("break");
  });

  it("opens More as the app's sheet of tiles, with polls and chat among the views behind it", () => {
    expect(STUDIO_PHONE_VIEWS).toEqual(expect.arrayContaining(["polls", "chat"]));
    const { host } = mount();
    const tabs = [...host.querySelectorAll<HTMLElement>(".pk-app-tabbar__link")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Home", "Speakers", "Graphics", "Questions", "More"]);
    void act(() => {
      tabs.at(-1)!.click();
    });
    const tiles = [...document.querySelectorAll<HTMLAnchorElement>(".pk-action-tiles .pk-action-tile")];
    expect(tiles.map((tile) => tile.textContent)).toEqual(["Polls", "Chat", "Monitors", "Screens", "Time", "Message"]);
    // A tile switches the panel in place and closes the sheet; its link carries the view for a new tab.
    expect(tiles[0]!.getAttribute("href")).toContain("panel=polls");
    void act(() => {
      tiles[0]!.click();
    });
    expect(host.querySelector('section[aria-label="polls"]')).not.toBeNull();
    expect(document.querySelector(".pk-action-tiles")).toBeNull();
    expect(tabs.at(-1)!.getAttribute("aria-current")).toBe("page");
  });

  it("offers the room's screens and a way back to the event at the end of More", () => {
    expect(STUDIO_PHONE_VIEWS).toContain("screens");
    const { host } = mount(vi.fn(), "/events/pqc-2026");
    void act(() => {
      [...host.querySelectorAll<HTMLElement>(".pk-app-tabbar__link")].at(-1)!.click();
    });
    const tiles = [...document.querySelectorAll<HTMLAnchorElement>(".pk-action-tiles .pk-action-tile")];
    expect(tiles.map((tile) => tile.textContent).slice(-3)).toEqual(["Time", "Message", "Back to the event"]);
    expect(tiles.find((tile) => tile.textContent === "Screens")!.getAttribute("href")).toContain("panel=screens");
    // A real link to the event's page, which also closes the sheet.
    const back = tiles.at(-1)!;
    expect(back.getAttribute("href")).toBe("#/events/pqc-2026");
    void act(() => {
      back.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector(".pk-action-tiles")).toBeNull();
  });
});
