// @vitest-environment jsdom
import { LIVE_SPEAKER_MESSAGE_MAX_LENGTH } from "../../assets/shared/live-room-outputs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_ELEMENTS,
  type LiveOverlayElement,
  type LiveOverlayLayoutGeometry,
} from "../../assets/shared/schemas/live-overlay-layout";
import { LIVE_OVERLAY_PROTOCOL_PREFIX, LIVE_ROOM_PROTOCOL } from "../../assets/shared/schemas/live-session-room";
import type { LiveOverlayView } from "../../assets/shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { LiveOverlay } from "../../assets/ts/live-session/LiveOverlay";
import { liveOverlayAddress, parseLiveOverlayAddress } from "../../assets/ts/live-session/live-overlay-address";
import {
  fakeLiveSockets,
  LIVE_OCCURRENCE,
  LIVE_POLL,
  LIVE_QUESTION,
  livePoll,
  livePollResults,
  liveSnapshot,
} from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];
const OVERLAY = { role: "overlay" as const, name: null };
const ON_STAGE = {
  ticker: null,
  panelists: null,
  schedule: null,
  checkIn: null,
  question: {
    id: LIVE_QUESTION,
    text: "What about hybrid certificates?",
    authorName: null,
    authorPhotoUrl: null,
    authorAffiliation: null,
  },
  questionChange: { operatorName: "Olga Operator", at: new Date().toISOString() },
  lowerThird: {
    key: "user:speaker",
    moderator: false,
    roleLabel: null,
    name: "Sam Speaker",
    photoUrl: null,
    identity: { title: "Architect", organization: "Example" },
  },
  lowerThirdChange: { operatorName: "Olga Operator", at: new Date().toISOString() },
  lowerThirdMotion: "cut" as const,
  poll: null,
  pollChange: null,
  timerGraphics: [],
};
const SESSION_TIMER = liveSnapshot().timers[0]!;
const FULL_FRAME = LIVE_OVERLAY_PRESET_LAYOUTS["full-frame"].elements;

/** A saved layout that shows only the given elements, the first of them in the given box. */
function savedLayout(
  slug: string,
  shown: readonly LiveOverlayElement[],
  box = { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
): LiveOverlayLayoutGeometry {
  return {
    slug,
    name: slug,
    elements: Object.fromEntries(
      LIVE_OVERLAY_ELEMENTS.map((element) => [
        element,
        { ...FULL_FRAME[element], ...(element === shown[0] ? box : {}), visible: shown.includes(element) },
      ]),
    ) as LiveOverlayLayoutGeometry["elements"],
  };
}

function mountOverlay(view: LiveOverlayView, layout = "full-frame", overlayLayouts: LiveOverlayLayoutGeometry[] = []) {
  const live = fakeLiveSockets();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => {
    render(
      <LiveOverlay
        view={view}
        layout={layout}
        slug="pqc-2026"
        occurrenceId={LIVE_OCCURRENCE}
        token="signed.overlay.access"
        createSocket={live.factory}
      />,
      host,
    );
  });
  void act(() => {
    live.latest().open();
    live.latest().deliver(liveSnapshot({ viewer: OVERLAY, stage: ON_STAGE, overlayLayouts }));
  });
  return { host, live };
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

describe("broadcast overlays", () => {
  it("joins read-only with the access as a subprotocol, never in the address", () => {
    const { live } = mountOverlay("program");
    expect(live.latest().protocols).toEqual([
      LIVE_ROOM_PROTOCOL,
      `${LIVE_OVERLAY_PROTOCOL_PREFIX}signed.overlay.access`,
    ]);
    expect(live.latest().url).not.toContain("signed.overlay.access");
  });

  it("renders the question on air, anonymous to the audience", () => {
    const { host } = mountOverlay("program", "question-only", [savedLayout("question-only", ["question"])]);
    expect(host.querySelector(".pk-live-overlay__question-text")?.textContent).toBe("What about hybrid certificates?");
    // Sized by its length, as on the stage display, inside a card of one fixed size.
    expect(host.querySelector<HTMLElement>(".pk-live-overlay__question-text")?.dataset.fit).toBe("regular");
    expect(host.querySelector(".pk-live-overlay__question-asker")?.textContent).toBe("Audience question");
    expect(host.textContent).not.toContain("Sam Speaker");
  });

  it("shows the asker's photo, or their initials, in place of the emblem when they asked by name", () => {
    const { host, live } = mountOverlay("program", "question-only", [savedLayout("question-only", ["question"])]);
    expect(host.querySelector(".pk-live-overlay__asker")).toBeNull();
    expect(host.querySelector(".pk-live-overlay__card .pk-live-overlay__emblem")).not.toBeNull();
    const ask = (authorPhotoUrl: string | null) =>
      void act(() =>
        live.latest().deliver({
          type: "stage.changed",
          stage: { ...ON_STAGE, question: { ...ON_STAGE.question!, authorName: "Bea Attendee", authorPhotoUrl } },
        }),
      );
    ask(null);
    expect(host.querySelector(".pk-live-overlay__asker .pk-avatar__initials")?.textContent).toBe("BA");
    const photo = "/api/v1/users/u1/headshots/portrait.jpg";
    ask(photo);
    expect(host.querySelector(".pk-live-overlay__asker img")?.getAttribute("srcset")).toContain(photo);
    expect(host.querySelector(".pk-live-overlay__question-asker")?.textContent).toBe("Bea Attendee");
  });

  it("names a host's or moderator's role above the name, and no role for a speaker", () => {
    const { host, live } = mountOverlay("program", "lower-third");
    expect(host.querySelector(".pk-live-overlay__role")).toBeNull();
    void act(() =>
      live.latest().deliver({
        type: "stage.changed",
        stage: { ...ON_STAGE, lowerThird: { ...ON_STAGE.lowerThird!, name: "Hana Host", roleLabel: "Host" } },
      }),
    );
    expect(host.querySelector(".pk-live-overlay__role")?.textContent).toBe("Host");
    expect(host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Hana Host");
  });

  it("renders the lower third from the approved credit", () => {
    const { host } = mountOverlay("program", "lower-third");
    expect(host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    const title = host.querySelector(".pk-live-overlay__title")!;
    // One line: the title and organization of the identity the speaker acts as.
    expect(title.textContent).toBe("Architect, Example");
  });

  it("composes Program in full, while a source on another layout shows only that layout's elements", () => {
    const { host, live } = mountOverlay("program");
    expect(host.querySelector(".pk-live-overlay__question-text")?.textContent).toBe("What about hybrid certificates?");
    expect(host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    expect(host.querySelector(".pk-live-overlay__lower-third-bars")?.getAttribute("viewBox")).toBe("0 0 2500 417");
    expect(host.querySelector(".pk-live-overlay__timer")).toBeNull();
    const scene = mountOverlay("program", "lower-third");
    expect(scene.host.querySelector(".pk-live-overlay__question-text")).toBeNull();
    expect(scene.host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    void act(() => live.latest().deliver({ type: "stage.changed", stage: { ...ON_STAGE, lowerThird: null } }));
    expect(host.querySelector(".pk-live-overlay__name")).toBeNull();
    expect(host.querySelector(".pk-live-overlay__question-text")?.textContent).toBe("What about hybrid certificates?");
  });

  it("places each element in its layout box, follows layout changes, and draws the default for an unknown name", () => {
    const keynote = savedLayout("keynote", ["lowerThird"]);
    const { host, live } = mountOverlay("program", "keynote", [keynote]);
    const placed = (name: string) =>
      host
        .querySelector<HTMLElement>('[data-overlay-element="lowerThird"] > .pk-live-overlay__surface')
        ?.style.getPropertyValue(name);
    // jsdom measures nothing, so the graphic keeps the whole frame and fits the box: a quarter size at its center.
    expect(placed("--overlay-dx")).toBe("960px");
    expect(placed("--overlay-dy")).toBe("540px");
    expect(placed("--overlay-scale")).toBe("0.25");
    expect(host.querySelector(".pk-live-overlay__question-text")).toBeNull();
    void act(() =>
      live.latest().deliver({
        type: "overlay.layouts.changed",
        layouts: [savedLayout("keynote", ["lowerThird", "question"], { x: 0, y: 0, w: 0.5, h: 0.5 })],
      }),
    );
    expect(placed("--overlay-dx")).toBe("0px");
    expect(placed("--overlay-scale")).toBe("0.5");
    expect(host.querySelector(".pk-live-overlay__question-text")?.textContent).toBe("What about hybrid certificates?");
    const unknown = mountOverlay("program", "no-such-scene", [keynote]);
    expect(unknown.host.querySelector(".pk-live-overlay__question-text")).not.toBeNull();
    expect(unknown.host.querySelector(".pk-live-overlay__name")).not.toBeNull();
  });

  it("draws the program timer graphic in its own format, label and warning color", () => {
    const { host, live } = mountOverlay("program");
    const graphic = { ...defaultLiveTimerGraphic("session"), presentation: "digital" as const, label: "Time left" };
    void act(() => {
      live.latest().deliver({ type: "timers.changed", timers: [{ ...SESSION_TIMER, heldMs: 42_000 }] });
      live.latest().deliver({
        type: "stage.changed",
        stage: { ...ON_STAGE, timerGraphics: [{ ...graphic, format: "hh:mm:ss" }] },
      });
    });
    const drawn = host.querySelector<HTMLElement>(".pk-live-overlay__timer")!;
    expect(drawn.querySelector(".pk-live-overlay__timer-value")?.textContent).toBe("00:00:42");
    expect(drawn.querySelector(".pk-live-overlay__timer-label")?.textContent).toBe("Time left");
    expect(drawn.dataset.tone).toBe("warn");
    void act(() =>
      live.latest().deliver({
        type: "stage.changed",
        stage: { ...ON_STAGE, timerGraphics: [{ ...graphic, showLabel: false, warningSeconds: 30 }] },
      }),
    );
    expect(host.querySelector(".pk-live-overlay__timer-label")).toBeNull();
    expect(host.querySelector<HTMLElement>(".pk-live-overlay__timer")!.dataset.tone).toBeUndefined();
    void act(() => live.latest().deliver({ type: "stage.changed", stage: ON_STAGE }));
    expect(host.querySelector(".pk-live-overlay__timer")).toBeNull();
  });

  it("renders several timers independently, including custom text without a logo", () => {
    const { host, live } = mountOverlay("program");
    const pitch = {
      ...SESSION_TIMER,
      id: "pitch",
      name: "Pitch",
      kind: "duration" as const,
      durationSeconds: 180,
      heldMs: 180_000,
      running: false,
      anchorAt: null,
    };
    void act(() => {
      live.latest().deliver({ type: "timers.changed", timers: [SESSION_TIMER, pitch] });
      live.latest().deliver({
        type: "stage.changed",
        stage: {
          ...ON_STAGE,
          timerGraphics: [
            defaultLiveTimerGraphic("session"),
            {
              ...defaultLiveTimerGraphic("pitch"),
              format: "custom",
              customFormat: "{{minutes}} minutes and {{seconds}} seconds",
              showLogo: false,
            },
          ],
        },
      });
    });
    const timers = host.querySelectorAll(".pk-live-overlay__timer");
    expect(timers).toHaveLength(2);
    expect(timers[1]?.textContent).toContain("3 minutes and 0 seconds");
    expect(timers[1]?.querySelector("svg")).toBeNull();
    expect(host.querySelectorAll('[data-overlay-element="timer"]')).toHaveLength(2);
  });

  it("puts the timer graphic in the layout's timer box unless the graphic names its own corner", () => {
    const timed = savedLayout("timed", ["timer"], { x: 0.5, y: 0, w: 0.5, h: 0.5 });
    const { host, live } = mountOverlay("program", "timed", [timed]);
    const placed = () =>
      host
        .querySelector<HTMLElement>('[data-overlay-element="timer"] > .pk-live-overlay__surface')
        ?.style.getPropertyValue("--overlay-dx");
    void act(() =>
      live.latest().deliver({
        type: "stage.changed",
        stage: { ...ON_STAGE, timerGraphics: [defaultLiveTimerGraphic("session")] },
      }),
    );
    expect(placed()).toBe("960px");
    void act(() =>
      live.latest().deliver({
        type: "stage.changed",
        stage: { ...ON_STAGE, timerGraphics: [{ ...defaultLiveTimerGraphic("session"), placement: "top-left" }] },
      }),
    );
    expect(placed()).toBe("96px");
  });

  it("clears the lower third when the operator takes it down", () => {
    const { host, live } = mountOverlay("program", "lower-third");
    void act(() => live.latest().deliver({ type: "stage.changed", stage: { ...ON_STAGE, lowerThird: null } }));
    expect(host.querySelector(".pk-live-overlay__name")).toBeNull();
  });

  it("shows the poll on air with its tallies and clears when it leaves the air", () => {
    const { host, live } = mountOverlay("program");
    expect(host.querySelector(".pk-live-overlay__poll-question")).toBeNull();
    const tallied = livePoll({ results: livePollResults({ "Root CA": 1, "TLS endpoints": 3 }) });
    void act(() => {
      live.latest().deliver({ type: "poll.changed", poll: tallied });
      live.latest().deliver({
        type: "stage.changed",
        stage: {
          ...ON_STAGE,
          poll: { id: LIVE_POLL, presentation: { chart: "bar" } },
        },
      });
    });
    expect(host.querySelector(".pk-live-overlay__poll-question")?.textContent).toBe("Which migration comes first?");
    expect([...host.querySelectorAll(".pk-meter__fill")].map((bar) => bar.getAttribute("data-fill"))).toEqual([
      "25",
      "75",
    ]);
    void act(() => live.latest().deliver({ type: "stage.changed", stage: ON_STAGE }));
    expect(host.querySelector(".pk-live-overlay__poll-question")).toBeNull();
  });

  it("floats each reaction burst", () => {
    const reactions = mountOverlay("program");
    void act(() =>
      reactions.live
        .latest()
        .deliver({ type: "reaction.burst", counts: { applause: 2, love: 1 }, at: new Date().toISOString() }),
    );
    expect([...reactions.host.querySelectorAll(".pk-live-overlay__reaction")].map((node) => node.textContent)).toEqual([
      "👏",
      "👏",
      "❤️",
    ]);
  });

  it("renders each auxiliary output from its own composition, not Program's", () => {
    const projector = mountOverlay("projector");
    expect(projector.host.querySelector(".pk-live-overlay__name")).toBeNull();
    void act(() =>
      projector.live.latest().deliver({
        type: "aux.changed",
        output: "projector",
        composition: { ...ON_STAGE, question: null, timerGraphics: [defaultLiveTimerGraphic("session")] },
      }),
    );
    expect(projector.host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    expect(projector.host.querySelector(".pk-live-overlay__question-text")).toBeNull();
    expect(projector.host.querySelector(".pk-live-overlay__timer")).not.toBeNull();
    const preview = mountOverlay("stage-preview");
    expect(preview.host.querySelector(".pk-live-overlay__name")).toBeNull();
  });

  it("shows the speaker the timer it picked, the operator's message and the question on the stage display", () => {
    const { host, live } = mountOverlay("stage-display");
    expect(host.querySelector(".pk-live-stage-display__countdown")).toBeNull();
    const pitch = {
      ...SESSION_TIMER,
      id: "pitch",
      name: "Pitch",
      kind: "duration" as const,
      durationSeconds: 300,
      heldMs: 300_000,
    };
    void act(() => {
      live.latest().deliver({ type: "timers.changed", timers: [SESSION_TIMER, pitch] });
      live.latest().deliver({
        type: "aux.changed",
        output: "stage-display",
        composition: { ...ON_STAGE, lowerThird: null, timerGraphics: [defaultLiveTimerGraphic("pitch")] },
      });
      live.latest().deliver({
        type: "speaker.message.changed",
        speakerMessage: { text: "Please wrap up", tone: "warning", flash: false, change: null },
      });
    });
    expect(host.querySelector(".pk-live-stage-display__countdown")?.textContent).toBe("05:00");
    expect(host.querySelector(".pk-live-stage-display__timer .pk-live-stage-display__label")?.textContent).toBe(
      "Pitch",
    );
    expect(host.querySelector(".pk-live-stage-display__message")?.textContent).toBe("Please wrap up");
    expect(host.querySelector(".pk-live-stage-display__question")?.textContent).toContain(
      "What about hybrid certificates?",
    );
    expect(host.querySelector(".pk-live-overlay__lower-third-bars")).toBeNull();
  });

  it("shows the speaker the question on Program and the next one from Preview, large and labeled", () => {
    const { host, live } = mountOverlay("stage-display");
    const next = {
      id: "20000000-0000-4000-8000-0000000000b2",
      text: "Which clients still fail a hybrid handshake?",
      authorName: "Riley Chen",
      authorPhotoUrl: null,
      authorAffiliation: { organization: { name: "Example Bank" } },
    };
    const questions = () =>
      [...host.querySelectorAll<HTMLElement>(".pk-live-stage-display__question")].map((figure) => ({
        label: figure.querySelector(".pk-live-stage-display__label")?.textContent,
        text: figure.querySelector(".pk-live-stage-display__question-text")?.textContent,
        asker: figure.querySelector(".pk-live-stage-display__asker")?.textContent,
        next: figure.hasAttribute("data-next"),
      }));
    void act(() => live.latest().deliver({ type: "stage.display.next.changed", question: next }));
    expect(questions()).toEqual([
      { label: "Question", text: "What about hybrid certificates?", asker: "Audience question", next: false },
      { label: "Next question", text: next.text, asker: "Riley Chen, Example Bank", next: true },
    ]);
    // Taken to Program, the next question becomes the current one and is not repeated below it.
    void act(() => live.latest().deliver({ type: "stage.changed", stage: { ...ON_STAGE, question: next } }));
    expect(questions().map((question) => question.label)).toEqual(["Question"]);
    // A long question steps down in size, never below the smallest readable step.
    void act(() =>
      live
        .latest()
        .deliver({ type: "stage.changed", stage: { ...ON_STAGE, question: { ...next, text: "x ".repeat(150) } } }),
    );
    expect(host.querySelector<HTMLElement>(".pk-live-stage-display__question-text")?.dataset.fit).toBe("longest");
  });

  it("never shows Preview's question on an audience output", () => {
    const { host, live } = mountOverlay("projector");
    void act(() =>
      live.latest().deliver({
        type: "stage.display.next.changed",
        question: { ...ON_STAGE.question, id: "20000000-0000-4000-8000-0000000000b3", text: "Preview only" },
      }),
    );
    expect(host.textContent).not.toContain("Preview only");
  });

  it("asks the room for the output it draws, so only the stage display receives what is next", () => {
    const { live } = mountOverlay("stage-display");
    expect(new URL(live.latest().url).searchParams.get("output")).toBe("stage-display");
  });

  it("sets the message to the speaker in its tone, smaller only as it grows longer", () => {
    const { host, live } = mountOverlay("stage-display");
    const shown = () => host.querySelector<HTMLElement>(".pk-live-stage-display__message")!;
    const say = (text: string, tone: "neutral" | "urgent") =>
      void act(() =>
        live
          .latest()
          .deliver({ type: "speaker.message.changed", speakerMessage: { text, tone, flash: false, change: null } }),
      );
    say("Please wrap up", "urgent");
    expect([shown().dataset.speakerTone, shown().dataset.fit]).toEqual(["urgent", "regular"]);
    say("Two more questions from the room, then the panel closes", "neutral");
    expect([shown().dataset.speakerTone, shown().dataset.fit]).toEqual(["neutral", "long"]);
    say("x".repeat(LIVE_SPEAKER_MESSAGE_MAX_LENGTH), "neutral");
    expect(shown().dataset.fit).toBe("longer");
    expect(shown().hasAttribute("data-flash")).toBe(false);
    void act(() =>
      live.latest().deliver({
        type: "speaker.message.changed",
        speakerMessage: { text: "Please wrap up", tone: "urgent", flash: true, change: null },
      }),
    );
    expect(shown().hasAttribute("data-flash")).toBe(true);
  });

  it("names the output and layout in the query, and the room and access in the fragment only", () => {
    const address = liveOverlayAddress("https://pkic.org", {
      view: "program",
      layout: "lower-third",
      slug: "pqc-2026",
      roomId: "33333333-3333-4333-8333-333333333333",
      token: "signed.overlay.access",
    });
    const url = new URL(address);
    expect(url.pathname).toBe("/live-overlay/");
    expect(url.search).toBe("?view=program&layout=lower-third");
    expect(url.search).not.toContain("access");
    expect(parseLiveOverlayAddress(url)).toEqual({
      view: "program",
      layout: "lower-third",
      slug: "pqc-2026",
      roomId: "33333333-3333-4333-8333-333333333333",
      token: "signed.overlay.access",
    });
    const fallback = new URL(address.replace("layout=lower-third", "layout=Not%20a%20name"));
    expect(parseLiveOverlayAddress(fallback)?.layout).toBe("full-frame");
    expect(
      new URL(liveOverlayAddress("https://pkic.org", { ...parseLiveOverlayAddress(url)!, layout: "full-frame" }))
        .search,
    ).toBe("?view=program");
    expect(parseLiveOverlayAddress({ search: "?view=lower-third", hash: url.hash })).toBeNull();
    expect(parseLiveOverlayAddress({ search: "?view=program", hash: "" })).toBeNull();
  });
});
