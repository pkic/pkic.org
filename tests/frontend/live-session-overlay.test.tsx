// @vitest-environment jsdom
import { LIVE_SPEAKER_MESSAGE_MAX_LENGTH } from "../../assets/shared/live-room-outputs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_OVERLAY_STANDARD_ELEMENTS } from "../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_ELEMENTS,
  type LiveOverlayElement,
  type LiveOverlayLayoutGeometry,
} from "../../assets/shared/schemas/live-overlay-layout";
import { LIVE_OVERLAY_PROTOCOL_PREFIX, LIVE_ROOM_PROTOCOL } from "../../assets/shared/schemas/live-session-room";
import type { LiveOverlayView } from "../../assets/shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { LiveOverlay } from "../../assets/ts/live-session/LiveOverlay";
import {
  ALL_LIVE_OVERLAY_GRAPHICS,
  type LiveOverlayGraphics,
} from "../../assets/ts/live-session/live-overlay-graphics";
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
    addressedTo: null,
  },
  questionChange: { operatorName: "Olga Operator", at: new Date().toISOString() },
  lowerThird: {
    key: "user:speaker",
    moderator: false,
    roleLabel: null,
    titleLine: null,
    name: "Sam Speaker",
    photoUrl: null,
    identity: { title: "Architect", organization: "Example" },
    additionalIdentities: [],
  },
  lowerThirdChange: { operatorName: "Olga Operator", at: new Date().toISOString() },
  lowerThirdMotion: "cut" as const,
  poll: null,
  pollChange: null,
  timerGraphics: [],
  topQuestions: null,
  chatFeed: null,
  reactions: false,
  reactionsGraphic: { showCount: false },
  scene: null,
};
const SESSION_TIMER = liveSnapshot().timers[0]!;
const FULL_FRAME = LIVE_OVERLAY_STANDARD_ELEMENTS;

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

/** A saved scene that shows only the speaker's name, in the standard box. */
const NAME_ONLY = savedLayout("name-only", ["lowerThird"], FULL_FRAME.lowerThird);
/** A saved scene that shows every graphic in its standard box: the built-in scenes each show only some. */
const EVERYTHING: LiveOverlayLayoutGeometry = { slug: "everything", name: "Everything", elements: FULL_FRAME };

function mountOverlay(
  view: LiveOverlayView,
  layout = EVERYTHING.slug,
  overlayLayouts: LiveOverlayLayoutGeometry[] = [EVERYTHING],
  graphics: LiveOverlayGraphics = ALL_LIVE_OVERLAY_GRAPHICS,
) {
  const live = fakeLiveSockets();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => {
    render(
      <LiveOverlay
        view={view}
        layout={layout}
        graphics={graphics}
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
    // Anonymous: the eyebrow says whose question it is, and no byline repeats it.
    expect(host.querySelector(".pk-live-board__eyebrow")?.textContent).toBe("Audience question");
    expect(host.querySelector(".pk-live-overlay__question-asker")).toBeNull();
    expect(host.textContent).not.toContain("Sam Speaker");
  });

  it("shows the asker's photo, or their initials, beside their name when they asked by name", () => {
    const { host, live } = mountOverlay("program", "question-only", [savedLayout("question-only", ["question"])]);
    expect(host.querySelector(".pk-live-board-question__asker")).toBeNull();
    // A board carries no logo: the frame's one logo is the background's, and this scene has none.
    expect(host.querySelector(".pk-live-board__logo")).toBeNull();
    const ask = (authorPhotoUrl: string | null) =>
      void act(() =>
        live.latest().deliver({
          type: "stage.changed",
          stage: { ...ON_STAGE, question: { ...ON_STAGE.question!, authorName: "Bea Attendee", authorPhotoUrl } },
        }),
      );
    ask(null);
    expect(host.querySelector(".pk-live-board-question__asker .pk-avatar__initials")?.textContent).toBe("BA");
    const photo = "/api/v1/users/u1/headshots/portrait.jpg";
    ask(photo);
    expect(host.querySelector(".pk-live-board-question__asker img")?.getAttribute("srcset")).toContain(photo);
    expect(host.querySelector(".pk-live-overlay__question-asker")?.textContent).toBe("Bea Attendee");
  });

  it("names a host's or moderator's role above the name, and no role for a speaker", () => {
    const { host, live } = mountOverlay("program", "name-only", [NAME_ONLY]);
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
    const { host } = mountOverlay("program", "name-only", [NAME_ONLY]);
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
    const scene = mountOverlay("program", "name-only", [NAME_ONLY]);
    expect(scene.host.querySelector(".pk-live-overlay__question-text")).toBeNull();
    expect(scene.host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    void act(() => live.latest().deliver({ type: "stage.changed", stage: { ...ON_STAGE, lowerThird: null } }));
    expect(host.querySelector(".pk-live-overlay__name")).toBeNull();
    expect(host.querySelector(".pk-live-overlay__question-text")?.textContent).toBe("What about hybrid certificates?");
  });

  it("draws only the graphics a source shows, or all but those it hides", () => {
    const only = mountOverlay("program", EVERYTHING.slug, [EVERYTHING], {
      show: ["question"],
      hide: null,
      crop: false,
    });
    expect(only.host.querySelector(".pk-live-overlay__question-text")).not.toBeNull();
    expect(only.host.querySelector(".pk-live-overlay__name")).toBeNull();
    const except = mountOverlay("program", EVERYTHING.slug, [EVERYTHING], {
      show: null,
      hide: ["question"],
      crop: false,
    });
    expect(except.host.querySelector(".pk-live-overlay__question-text")).toBeNull();
    expect(except.host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    expect(except.host.querySelector(".pk-live-overlay__frame")?.hasAttribute("data-crop")).toBe(false);
  });

  it("crops the page to the one graphic left, and ignores crop while several are", () => {
    const box = FULL_FRAME.lowerThird;
    const cropped = mountOverlay("program", EVERYTHING.slug, [EVERYTHING], {
      show: ["lowerThird"],
      hide: null,
      crop: true,
    });
    const frame = cropped.host.querySelector<HTMLElement>(".pk-live-overlay__frame")!;
    expect(frame.hasAttribute("data-crop")).toBe(true);
    expect(frame.style.getPropertyValue("--crop-w")).toBe(String(box.w));
    expect(frame.style.getPropertyValue("--crop-y")).toBe(String(box.y));
    expect(cropped.host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    const several = mountOverlay("program", EVERYTHING.slug, [EVERYTHING], {
      show: ["lowerThird", "question"],
      hide: null,
      crop: true,
    });
    expect(several.host.querySelector(".pk-live-overlay__frame")?.hasAttribute("data-crop")).toBe(false);
  });

  it("draws a scene's background whenever the scene includes it, once, and no board draws a field of its own", () => {
    const grounds = (scope: HTMLElement) =>
      scope.querySelectorAll('[data-overlay-element="background"] .pk-live-board--ground');
    const logos = (scope: HTMLElement) => scope.querySelectorAll(".pk-live-board__logo");
    // A scene without the background draws none, and the board on it brings no field or logo of its own.
    const plain = mountOverlay("program");
    expect(plain.host.querySelector(".pk-live-overlay__question-text")).not.toBeNull();
    expect(grounds(plain.host)).toHaveLength(0);
    expect(logos(plain.host)).toHaveLength(0);
    // A scene with the background draws it under the question on air, and still once the question is off.
    const boards = savedLayout("boards", ["background", "question", "lowerThird"], { x: 0, y: 0, w: 1, h: 1 });
    const { host, live } = mountOverlay("program", "boards", [boards]);
    expect(grounds(host)).toHaveLength(1);
    expect(logos(host)).toHaveLength(1);
    void act(() => live.latest().deliver({ type: "stage.changed", stage: { ...ON_STAGE, question: null } }));
    expect(host.querySelector(".pk-live-overlay__question-text")).toBeNull();
    expect(grounds(host)).toHaveLength(1);
    // A full-frame question beside a background in a column still draws only the one background and logo.
    const aside = savedLayout("aside", ["background", "question", "lowerThird"], { x: 0.6, y: 0, w: 0.4, h: 1 });
    const scene = mountOverlay("program", "aside", [aside]);
    expect(scene.host.querySelector(".pk-live-overlay__question-text")).not.toBeNull();
    expect(grounds(scene.host)).toHaveLength(1);
    expect(logos(scene.host)).toHaveLength(1);
  });

  it("draws a scene's QR code to this session in the event app", () => {
    const holding = savedLayout("holding", ["lowerThird", "qrCode"]);
    const { host } = mountOverlay("program", "holding", [holding]);
    const code = host.querySelector('[data-overlay-element="qrCode"] svg[role="img"]');
    expect(code?.getAttribute("aria-label")).toBe("Code to ask questions in the event app");
    expect(host.querySelector('[data-overlay-element="qrCode"]')?.textContent).toContain(
      "Scan to ask a question and vote",
    );
    // A built-in scene leaves the QR code out until an organizer adds it.
    expect(mountOverlay("program", "default", []).host.querySelector('[data-overlay-element="qrCode"]')).toBeNull();
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
    // An unknown scene, or one retired since, draws as Default: the speaker's name, no board and no background.
    for (const scene of ["no-such-scene", "talk"]) {
      const unknown = mountOverlay("program", scene, [keynote]);
      expect(unknown.host.querySelector(".pk-live-overlay__name"), scene).not.toBeNull();
      expect(unknown.host.querySelector(".pk-live-overlay__question-text"), scene).toBeNull();
      expect(unknown.host.querySelector('[data-overlay-element="background"]'), scene).toBeNull();
    }
  });

  it("draws the program timer graphic in its own format, label and warning color", () => {
    const { host, live } = mountOverlay("program");
    const graphic = {
      ...defaultLiveTimerGraphic("session"),
      presentation: "digital" as const,
      showLabel: true,
      label: "Time left",
    };
    void act(() => {
      live.latest().deliver({ type: "timers.changed", timers: [{ ...SESSION_TIMER, heldMs: 42_000 }] });
      live.latest().deliver({
        type: "stage.changed",
        stage: { ...ON_STAGE, timerGraphics: [{ ...graphic, format: "ss" }] },
      });
    });
    const drawn = host.querySelector<HTMLElement>(".pk-live-overlay__timer")!;
    expect(drawn.querySelector(".pk-live-overlay__timer-value")?.textContent).toBe("42");
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
    const { host, live } = mountOverlay("program", "name-only", [NAME_ONLY]);
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

  it("floats one reaction per person who joined while reactions are on", () => {
    const reactions = mountOverlay("program");
    void act(() => reactions.live.latest().deliver({ type: "stage.changed", stage: { ...ON_STAGE, reactions: true } }));
    void act(() =>
      reactions.live.latest().deliver({
        type: "reaction.burst",
        counts: { applause: 2, love: 1 },
        people: { applause: 2, love: 1 },
        at: new Date().toISOString(),
      }),
    );
    expect([...reactions.host.querySelectorAll(".pk-live-overlay__reaction")].map((node) => node.textContent)).toEqual([
      "👏",
      "👏",
      "❤️",
    ]);
  });

  it("draws the projector's own composition, which the room keeps in step with Program, whether it syncs or not", () => {
    const projector = mountOverlay("projector");
    const sync = (on: boolean) =>
      void act(() =>
        projector.live
          .latest()
          .deliver({ type: "screen.sync.changed", screenSync: { projector: on, "stage-display": true } }),
      );
    const questionText = () => projector.host.querySelector(".pk-live-overlay__question-text")?.textContent ?? null;
    const hold = (composition: typeof ON_STAGE) =>
      void act(() => projector.live.latest().deliver({ type: "aux.changed", output: "projector", composition }));
    // The projector holds nothing yet, so nothing of Program's is drawn there by itself.
    expect(questionText()).toBeNull();
    // The room carries Program's question to it.
    hold(ON_STAGE);
    expect(questionText()).toBe("What about hybrid certificates?");
    void act(() =>
      projector.live.latest().deliver({
        type: "aux.changed",
        output: "projector",
        composition: { ...ON_STAGE, question: null, timerGraphics: [defaultLiveTimerGraphic("session")] },
      }),
    );
    expect(projector.host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    expect(questionText()).toBeNull();
    expect(projector.host.querySelector(".pk-live-overlay__timer")).not.toBeNull();
    // With sync off it stays as it is.
    sync(false);
    expect(projector.host.querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    expect(questionText()).toBeNull();
    // The stage preview follows the room on its own and never takes Program's graphics.
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
    expect(host.querySelector(".pk-live-stage-display__countdown")?.textContent).toBe("5:00");
    expect(host.querySelector(".pk-live-stage-display__timer .pk-live-stage-display__label")?.textContent).toBe(
      "Pitch",
    );
    expect(host.querySelector(".pk-live-stage-display__message")?.textContent).toBe("Please wrap up");
    expect(host.querySelector(".pk-live-stage-display__question-text")?.textContent).toBe(
      "What about hybrid certificates?",
    );
    // Sized by its length, as on Program: a longer question steps down so none of it is cut.
    expect(host.querySelector<HTMLElement>(".pk-live-stage-display__question-text")?.dataset.fit).toBe("regular");
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
      addressedTo: null,
    };
    const shown = () => ({
      tag: host.querySelector(".pk-live-stage-display__questions .pk-live-stage-display__tag")?.textContent ?? null,
      text: host.querySelector(".pk-live-stage-display__question-text")?.textContent ?? null,
      next: host.querySelector(".pk-live-stage-display__next-text")?.textContent ?? null,
    });
    void act(() => live.latest().deliver({ type: "stage.display.next.changed", question: next, votes: 31 }));
    expect(shown()).toEqual({ tag: "On air", text: "What about hybrid certificates?", next: next.text });
    // The room sends its votes with it, since a stage display source has no question list.
    expect(host.querySelector(".pk-live-stage-display__votes")?.textContent).toBe("31 votes");
    // Taken to Program, the next question becomes the current one and is not repeated below it.
    void act(() => live.latest().deliver({ type: "stage.changed", stage: { ...ON_STAGE, question: next } }));
    expect(shown()).toEqual({ tag: "On air", text: next.text, next: null });
    // Off Program, the question lined up next leads on its own.
    void act(() => live.latest().deliver({ type: "stage.changed", stage: { ...ON_STAGE, question: null } }));
    void act(() =>
      live.latest().deliver({ type: "stage.display.next.changed", question: { ...next, id: LIVE_QUESTION } }),
    );
    expect(shown()).toEqual({ tag: "Next question", text: null, next: "Which clients still fail a hybrid handshake?" });
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

  it("sets the message to the speaker in the banner, smaller only as it grows longer", () => {
    const { host, live } = mountOverlay("stage-display");
    const shown = () => host.querySelector<HTMLElement>(".pk-live-stage-display__message")!;
    const say = (text: string, flash = false) =>
      void act(() =>
        live
          .latest()
          .deliver({ type: "speaker.message.changed", speakerMessage: { text, tone: "urgent", flash, change: null } }),
      );
    say("Please wrap up");
    expect([shown().dataset.source, shown().dataset.fit]).toEqual(["operator", "regular"]);
    // The banner covers the top row: its clock and reactions keep their place, unseen.
    expect(host.querySelector(".pk-live-stage-display__top")?.hasAttribute("data-covered")).toBe(true);
    say("Two more questions from the room, then the panel closes");
    expect(shown().dataset.fit).toBe("long");
    say("x".repeat(LIVE_SPEAKER_MESSAGE_MAX_LENGTH));
    expect(shown().dataset.fit).toBe("longer");
    expect(shown().hasAttribute("data-flash")).toBe(false);
    say("Please wrap up", true);
    expect(shown().hasAttribute("data-flash")).toBe(true);
    void act(() => live.latest().deliver({ type: "speaker.message.changed", speakerMessage: null }));
    expect(host.querySelector(".pk-live-stage-display__message")).toBeNull();
    expect(host.querySelector(".pk-live-stage-display__top")?.hasAttribute("data-covered")).toBe(false);
  });
});
