// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_EMBLEM,
  LIVE_LOWER_THIRD_BRAND,
  LIVE_LOWER_THIRD_DRAWING,
  initialLiveLowerThird,
  liveLowerThirdEmblemPoint,
  stepLiveLowerThird,
  type LiveLowerThirdEvent,
  type LiveLowerThirdState,
} from "../../assets/shared/live-lower-third";
import type { LiveCredit } from "../../assets/shared/schemas/live-session-room";
import { LiveLowerThird } from "../../assets/ts/live-session/LiveLowerThird";
import { liveLowerThirdEmblemBox } from "../../assets/shared/live-lower-third";
import { liveRoomClientMessageSchema, type LiveRoomClientMessage } from "../../assets/shared/schemas/live-session-room";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { sendLayerToggle } from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";
import { liveSnapshot, liveTargets } from "./helpers/live-room-socket";

const credit = (key: string, name: string): LiveCredit => ({
  key,
  name,
  moderator: false,
  photoUrl: null,
  identity: { title: name, organization: "Example" },
  roleLabel: null,
});
const SAM = credit("user:sam", "Sam Speaker");
const PAT = credit("user:pat", "Pat Panelist");

/** Distance between two points of the drawing. */
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("the lower third's geometry", () => {
  it("places the emblem so the name bar leaves its orange seat, from the emblem's center and seat radius", () => {
    // The seat's outer arc meets the bar's two seat corners, within a unit of the 2500-unit drawing.
    const { nameBarSeat } = LIVE_LOWER_THIRD_DRAWING;
    expect(distance(liveLowerThirdEmblemPoint(LIVE_EMBLEM.orangeSeat.top), nameBarSeat.top)).toBeLessThan(1.6);
    expect(distance(liveLowerThirdEmblemPoint(LIVE_EMBLEM.orangeSeat.bottom), nameBarSeat.bottom)).toBeLessThan(2.6);
    // The emblem's center lands on the slot's center, which the bars were drawn around.
    const center = liveLowerThirdEmblemPoint(LIVE_EMBLEM.center);
    expect(center.x).toBeCloseTo(LIVE_LOWER_THIRD_DRAWING.emblem.center.x, 2);
    expect(center.y).toBeCloseTo(LIVE_LOWER_THIRD_DRAWING.emblem.center.y, 2);
  });

  it("draws the bars and the emblem exactly as the brand's stream overlay drew them", () => {
    const template = readFileSync(resolve(process.cwd(), "assets/js/event-overlays.js"), "utf8");
    const part = (id: string) => new RegExp(`id="${id}"[^>]*d="([^"]+)"`, "u").exec(template)![1]!;
    expect(LIVE_LOWER_THIRD_BRAND.nameBar).toBe(part("Name BG"));
    expect(LIVE_LOWER_THIRD_BRAND.titleBar).toBe(part("Title BG"));
    expect(LIVE_LOWER_THIRD_BRAND.emblem).toEqual({
      blue: part("Bottom"),
      orange: part("Right"),
      green: part("Left"),
      table: part("Table"),
      keyhole: part("Keyhole"),
    });
    // The title starts further right than the name, where the brand set it.
    expect(template).toContain(`translate(${LIVE_LOWER_THIRD_BRAND.nameX} 160)`);
    expect(template).toContain(`translate(${LIVE_LOWER_THIRD_BRAND.titleX} 310)`);
  });
  it("keeps the shared emblem's seat ends on its seat radius", () => {
    for (const end of [LIVE_EMBLEM.orangeSeat.top, LIVE_EMBLEM.orangeSeat.bottom])
      expect(distance(end, LIVE_EMBLEM.center)).toBeCloseTo(LIVE_EMBLEM.seatRadius, 2);
  });

  it("draws the stand-alone overlay page's lower third with the same attach point", () => {
    const template = readFileSync(resolve(process.cwd(), "assets/js/event-overlays.js"), "utf8");
    const right = /id="Right"[^>]*d="([^"]+)"/.exec(template)![1]!;
    const nameBar = /id="Name BG"[^>]*d="([^"]+)"/.exec(template)![1]!;
    // The orange seat's outline passes through both corners of the name bar's left edge.
    const arcEnds = [...right.matchAll(/(?:[ML]|0 0 [01] )([\d.]+) ([\d.]+)/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }));
    expect(nameBar.startsWith("m2331 6v228h-1949.5")).toBe(true);
    expect(arcEnds.some((end) => distance(end, LIVE_LOWER_THIRD_DRAWING.nameBarSeat.bottom) < 3)).toBe(true);
    expect(arcEnds.some((end) => distance(end, LIVE_LOWER_THIRD_DRAWING.nameBarSeat.top) < 1.6)).toBe(true);
  });
});

describe("the lower third's motion", () => {
  const change = (credit: LiveCredit | null, animate = true) => ({ type: "change" as const, credit, animate });
  const done = { type: "done" as const };
  const run = (state: LiveLowerThirdState<LiveCredit>, ...events: LiveLowerThirdEvent<LiveCredit>[]) =>
    events.reduce((current, event) => stepLiveLowerThird(current, event), state);

  it("enters, then shows; exits, then is gone", () => {
    const entering = run(initialLiveLowerThird<LiveCredit>(null), change(SAM));
    expect(entering).toMatchObject({ phase: "entering", shown: SAM });
    expect(run(entering, done)).toMatchObject({ phase: "shown", shown: SAM });
    const exiting = run(entering, done, change(null));
    expect(exiting).toMatchObject({ phase: "exiting", shown: SAM });
    expect(run(exiting, done)).toEqual({ phase: "idle", shown: null, incoming: null });
  });

  it("replaces a speaker by retracting and extending the bars while the emblem stays", () => {
    const retracting = run(initialLiveLowerThird(SAM), change(PAT));
    expect(retracting).toMatchObject({ phase: "retracting", shown: SAM, incoming: PAT });
    const extending = run(retracting, done);
    expect(extending).toMatchObject({ phase: "extending", shown: PAT, incoming: null });
    expect(run(extending, done)).toMatchObject({ phase: "shown", shown: PAT });
    // Taken off while the bars retract, it leaves altogether.
    expect(run(retracting, change(null))).toMatchObject({ phase: "exiting", shown: SAM });
  });

  it("never moves for the same lower third again, and cuts when motion is off", () => {
    const shown = initialLiveLowerThird(SAM);
    const refreshed = { ...SAM, affiliations: ["New title"] };
    expect(run(shown, change(refreshed))).toEqual({ phase: "shown", shown: refreshed, incoming: null });
    expect(run(shown, change(PAT, false))).toEqual({ phase: "shown", shown: PAT, incoming: null });
    expect(run(shown, change(null, false))).toEqual({ phase: "idle", shown: null, incoming: null });
  });
});

describe("the lower third on screen", () => {
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    for (const host of hosts.splice(0)) {
      render(null, host);
      host.remove();
    }
    vi.useRealTimers();
  });
  function mount(initial: LiveCredit | null) {
    const host = document.body.appendChild(document.createElement("div"));
    hosts.push(host);
    const draw = (credit: LiveCredit | null, animate = true) =>
      act(() => render(<LiveLowerThird credit={credit} animate={animate} />, host));
    void draw(initial);
    const graphic = () => host.querySelector<HTMLElement>(".pk-live-overlay__lower-third-graphic");
    /** The browser finishing the current phase's motion. */
    const finish = () =>
      act(() => {
        const node = graphic()!;
        const event = new Event("animationend", { bubbles: true }) as Event & { animationName: string };
        Object.defineProperty(event, "animationName", { value: `pk-live-lower-third-phase-${node.dataset.phase}` });
        node.dispatchEvent(event);
      });
    const name = () => host.querySelector(".pk-live-overlay__name")?.textContent ?? null;
    return { draw, graphic, finish, name };
  }

  it("shows what is on air when first drawn, and does not replay on a re-render", () => {
    const view = mount(SAM);
    expect(view.graphic()?.dataset.phase).toBe("shown");
    void view.draw({ ...SAM });
    expect(view.graphic()?.dataset.phase).toBe("shown");
  });

  it("plays the way in and out, and swaps the name only once the bars are back in the emblem", () => {
    const view = mount(null);
    void view.draw(SAM);
    expect(view.graphic()?.dataset.phase).toBe("entering");
    void view.finish();
    expect(view.graphic()?.dataset.phase).toBe("shown");
    void view.draw(PAT);
    expect([view.graphic()?.dataset.phase, view.name()]).toEqual(["retracting", "Sam Speaker"]);
    void view.finish();
    expect([view.graphic()?.dataset.phase, view.name()]).toEqual(["extending", "Pat Panelist"]);
    void view.finish();
    void view.draw(null);
    expect(view.graphic()?.dataset.phase).toBe("exiting");
    void view.finish();
    expect(view.graphic()).toBeNull();
  });

  it("cuts straight to each state when motion is off", () => {
    const view = mount(SAM);
    void view.draw(PAT, false);
    expect([view.graphic()?.dataset.phase, view.name()]).toEqual(["shown", "Pat Panelist"]);
    void view.draw(null, false);
    expect(view.graphic()).toBeNull();
  });

  it("moves on by itself when the browser reports no motion", () => {
    vi.useFakeTimers();
    const view = mount(SAM);
    void view.draw(null);
    expect(view.graphic()?.dataset.phase).toBe("exiting");
    void act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(view.graphic()).toBeNull();
  });

  it("draws the emblem in the box its geometry gives, so the bar leaves the orange seat at any size", () => {
    const view = mount(SAM);
    const emblem = view.graphic()!.querySelector("svg.pk-live-overlay__lower-third-emblem")!;
    const box = liveLowerThirdEmblemBox();
    expect(["x", "y", "width", "height"].map((name) => Number(emblem.getAttribute(name)))).toEqual([
      box.x,
      box.y,
      box.size,
      box.size,
    ]);
  });
});

describe("the lower third's motion setting", () => {
  it("travels with each lower third put on an output, as the operators chose it on Preview", () => {
    const snapshot = liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } });
    const state = applyLiveRoomMessage(null, {
      ...snapshot,
      preview: { ...snapshot.preview, lowerThirdMotion: "cut" },
    })!;
    const sent: LiveRoomClientMessage[] = [];
    const targets = liveTargets(state, { sendProgram: (message) => (sent.push(message), true) });
    const layer = { kind: "lowerThird" as const, key: state.session.credits[0]!.key };
    sendLayerToggle(targets, layer, "program");
    sendLayerToggle(targets, layer, "preview");
    sendLayerToggle(targets, layer, "projector");
    const [program, preview, projector] = sent.map((message) => liveRoomClientMessageSchema.parse(message));
    expect(program).toMatchObject({ type: "stage.lowerThird", motion: "cut" });
    expect(preview).toMatchObject({ type: "preview.set", composition: { lowerThirdMotion: "cut" } });
    expect(projector).toMatchObject({ type: "aux.set", output: "projector", composition: { lowerThirdMotion: "cut" } });
  });
});
