import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../../assets/shared/schemas/live-session-graphic-settings";
// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
import { liveRoomOpenFailure } from "../../assets/ts/live-session/live-room-copy";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import {
  LIVE_POLL,
  LIVE_QUESTION,
  livePoll,
  livePollResults,
  liveQuestion,
  liveSnapshot,
} from "./helpers/live-room-socket";
import {
  OPERATOR,
  button,
  commands,
  labeled,
  mountClosedDesk,
  mountDesk,
  panel,
  resetDeskStorage,
  take,
  type,
  unmountDesks,
} from "./helpers/live-desk";

beforeEach(resetDeskStorage);
afterEach(unmountDesks);

describe("live control room Transition", () => {
  it("changes the shared Preview through the room, counts the differences and transitions it", () => {
    const { host, live } = mountDesk();
    void act(() => labeled(host, "Prepare Sam Speaker in Preview").click());
    expect(commands(live)).toEqual([
      { type: "preview.set", composition: { creditKey: "user:speaker", lowerThirdMotion: "animated" } },
    ]);
    // Preview is the room's: it changes when the room says so, for every operator alike.
    const snapshot = liveSnapshot({ viewer: OPERATOR });
    const credit = snapshot.session.credits[0]!;
    const changedBy = { operatorName: "Remote Rita", at: new Date().toISOString() };
    void act(() =>
      live.latest().deliver({
        type: "preview.changed",
        composition: { ...snapshot.preview, lowerThird: credit, lowerThirdChange: changedBy },
      }),
    );
    expect(panel(host, "Preview").querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    expect(panel(host, "Monitors").querySelector(".pk-live-overlay__name")).toBeNull();
    void act(() => take(host).click());
    expect(commands(live).at(-1)).toEqual({ type: "preview.take" });
    void act(() => live.latest().deliver({ type: "stage.changed", stage: { ...snapshot.stage, lowerThird: credit } }));
    expect(panel(host, "Monitors").querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
    // Preview keeps its contents after the Take.
    expect(panel(host, "Preview").querySelector(".pk-live-overlay__name")?.textContent).toBe("Sam Speaker");
  });

  it("clears the shared Preview from its monitor", () => {
    const { host, live } = mountDesk();
    const snapshot = liveSnapshot({ viewer: OPERATOR });
    void act(() =>
      live.latest().deliver({
        type: "preview.changed",
        composition: {
          ...snapshot.preview,
          lowerThird: snapshot.session.credits[0]!,
          timerGraphics: [defaultLiveTimerGraphic("session")],
        },
      }),
    );
    void act(() => labeled(host, "Clear Preview").click());
    expect(commands(live)).toEqual([
      {
        type: "preview.set",
        composition: {
          creditKey: null,
          questionId: null,
          pollId: null,
          pollPresentation: { chart: "bar" },
          ticker: null,
          panelists: null,
          schedule: null,
          checkIn: null,
          checkInTheme: "black-on-white",
          checkInText: DEFAULT_LIVE_CHECK_IN_TEXT,
          lowerThirdMotion: "animated",
          timerGraphics: [],
        },
      },
    ]);
  });

  it("puts the timer on the shared Preview and toggles it on Program directly", () => {
    const { host, live } = mountDesk(undefined, "stage");
    void act(() => labeled(host, "Show timer in preview").click());
    void act(() => labeled(host, "Show timer on air").click());
    const graphic = defaultLiveTimerGraphic("session");
    expect(commands(live)).toEqual([
      { type: "preview.set", composition: { timerGraphics: [graphic] } },
      { type: "stage.timer", timer: graphic, visible: true },
    ]);
  });
});

describe("live control room presence", () => {
  const RITA = {
    id: "0000abcd",
    name: "Remote Rita",
    focus: { panel: "speakers", item: "lowerThird:user:speaker", target: "program" as const },
    pointer: null,
    changed: false,
  };

  it("rings the control another operator is on, names them, and flashes who changed it", () => {
    const { host, live } = mountDesk();
    void act(() => live.latest().deliver({ type: "presence.changed", presence: RITA }));
    const speakers = panel(host, "Speakers");
    const chip = () => speakers.querySelector(".pk-live-person .pk-live-presence__chip");
    expect(chip()?.textContent).toBe("RRRemote Rita is here");
    expect(chip()?.querySelector(".pk-sr-only")?.textContent).toBe("Remote Rita is here");
    expect(labeled(host, "Show Sam Speaker on air").hasAttribute("data-presence-color")).toBe(true);
    expect(labeled(host, "Show Sam Speaker in preview").hasAttribute("data-presence-color")).toBe(false);
    // The panel names who is working in it.
    expect(speakers.querySelector(".pk-studio-panel__actions .pk-live-presence__chip")).not.toBeNull();

    void act(() => live.latest().deliver({ type: "presence.changed", presence: { ...RITA, changed: true } }));
    expect(chip()?.getAttribute("data-flash")).toBe("true");
    expect(chip()?.querySelector(".pk-sr-only")?.textContent).toBe("Remote Rita changed this");

    void act(() => live.latest().deliver({ type: "presence.left", id: RITA.id }));
    expect(chip()).toBeNull();
    expect(labeled(host, "Show Sam Speaker on air").hasAttribute("data-presence-color")).toBe(false);
  });

  it("draws another operator's pointer on the same monitor output, wherever that monitor is", () => {
    const { host, live } = mountDesk();
    void act(() =>
      live.latest().deliver({
        type: "presence.changed",
        presence: { ...RITA, focus: null, pointer: { output: "program", x: 0.25, y: 0.5 } },
      }),
    );
    const pointers = [...host.querySelectorAll<SVGElement>(".pk-live-pointers")];
    expect(pointers).toHaveLength(1);
    expect(pointers[0]!.closest(".pk-studio-monitor__tile")?.getAttribute("data-tally")).toBe("program");
    expect(pointers[0]!.getAttribute("aria-label")).toBe("Pointing here: Remote Rita");
    const dot = pointers[0]!.querySelector("svg[data-presence-color]")!;
    expect([dot.getAttribute("x"), dot.getAttribute("y")]).toEqual(["25.00%", "50.00%"]);
    expect(dot.textContent).toBe("RR");
  });

  it("reports the control this operator is on by its ids, at most ten times a second", async () => {
    const { host, live } = mountDesk();
    const hover = (target: Element) =>
      void act(() => {
        target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      });
    hover(labeled(host, "Show Sam Speaker on air"));
    hover(labeled(host, "Show Sam Speaker in preview"));
    const updates = () =>
      live
        .latest()
        .messages()
        .filter((message) => message.type === "presence.update");
    expect(updates()).toEqual([
      {
        type: "presence.update",
        focus: { panel: "speakers", item: "lowerThird:user:speaker", target: "program" },
        pointer: null,
        changed: false,
      },
    ]);
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(updates().at(-1)).toMatchObject({ focus: { target: "preview" } });
    expect(updates()).toHaveLength(2);
  });
});

describe("live control room panels", () => {
  it("sets how lower thirds go on air from the Speakers panel's menu, not from Graphics", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR }));
    expect(panel(host, "Graphics").textContent).not.toContain("Lower third");
    void act(() => labeled(panel(host, "Speakers"), "Speakers panel").click());
    void act(() => button(host, "Lower third settings").click());
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    void act(() => dialog.querySelector<HTMLInputElement>('input[value="cut"]')!.click());
    void act(() => button(dialog, "Save").click());
    expect(commands(live)).toEqual([{ type: "preview.set", composition: { lowerThirdMotion: "cut" } }]);
  });

  it("moderates a submitted question, puts an approved one on Program and marks it answered", () => {
    const pending = liveQuestion({ status: "pending", votes: 0, anonymous: true, authorName: "Ada Attendee" });
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [pending] }));
    const questions = panel(host, "Questions");
    expect(questions.textContent).toContain("Awaiting moderation");
    expect(questions.textContent).toContain("1 open");
    void act(() => button(questions, "Approve").click());
    void act(() =>
      live.latest().deliver({
        type: "question.changed",
        question: liveQuestion({ anonymous: true, authorName: "Ada Attendee" }),
      }),
    );
    void act(() => labeled(questions, "Show question on air").click());
    void act(() => button(questions, "Answered").click());
    expect(commands(live)).toEqual([
      { type: "question.moderate", questionId: LIVE_QUESTION, expectedRevision: 0, status: "approved" },
      { type: "stage.question", questionId: LIVE_QUESTION },
      { type: "question.moderate", questionId: LIVE_QUESTION, expectedRevision: 0, status: "answered" },
    ]);
  });

  it("edits a question's shown text and keeps the author's words in view", () => {
    const rewritten = liveQuestion({
      text: "What about hybrid certificates?",
      originalText: "so like hybrid certs??",
      rewritten: { operatorName: "Remote Rita", at: new Date().toISOString() },
    });
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [rewritten] }));
    void act(() => labeled(host, "Question actions").click());
    void act(() => button(host, "Open question").click());
    expect(host.textContent).toContain("Asked as “so like hybrid certs??” · edited by Remote Rita");
    void act(() => button(host, "Done").click());
    void act(() => labeled(host, "Question actions").click());
    void act(() => button(host, "Edit text").click());
    type(host.querySelector<HTMLTextAreaElement>("textarea[name=text]")!, "Should we deploy hybrid certificates?");
    void act(() => button(host, "Save text").click());
    expect(commands(live)).toEqual([
      { type: "question.rewrite", questionId: LIVE_QUESTION, text: "Should we deploy hybrid certificates?" },
    ]);
  });

  it("runs several named timers from the Time panel", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR }), "stage");
    const time = panel(host, "Time");
    expect(time.querySelector("output")?.textContent).toBe("50:00");
    void act(() => labeled(time, "Start Session").click());
    void act(() => labeled(time, "Add a minute to Session").click());
    void act(() => labeled(time, "Take a minute from Session").click());
    // The create action sits in the panel header and opens the form.
    void act(() => labeled(time, "Add timer").click());
    type(time.querySelector<HTMLInputElement>("input[name=name]")!, "Questions");
    type(time.querySelector<HTMLInputElement>("input[name=durationSeconds]")!, "10");
    void act(() => button(time, "Add timer").click());
    expect(commands(live).map((sent) => liveRoomClientMessageSchema.parse(sent))).toEqual([
      { type: "timer.control", timerId: "session", action: "start" },
      { type: "timer.adjust", timerId: "session", deltaSeconds: 60 },
      { type: "timer.adjust", timerId: "session", deltaSeconds: -60 },
      { type: "timer.add", timer: { name: "Questions", kind: "duration", targetAt: null, durationSeconds: 600 } },
    ]);
    expect(time.querySelector("input[name=durationSeconds]")).toBeNull();
    const [session] = liveSnapshot().timers;
    const questions = {
      ...session!,
      id: "qa",
      name: "Questions",
      kind: "duration" as const,
      durationSeconds: 600,
      heldMs: 600_000,
    };
    void act(() => live.latest().deliver({ type: "timers.changed", timers: [session!, questions] }));
    expect([...time.querySelectorAll("output")].map((value) => value.textContent)).toEqual(["50:00", "10:00"]);
    void act(() => labeled(time, "Start Questions").click());
    expect(commands(live).at(-1)).toEqual({ type: "timer.control", timerId: "qa", action: "start" });
  });

  it("sends the timer graphic with its own settings", () => {
    const { host, live } = mountDesk(undefined, "stage");
    void act(() => labeled(host, "Session graphic settings").click());
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    type(dialog.querySelector<HTMLInputElement>("input[name=label]")!, "Time left");
    for (const [name, value] of [
      ["format", "hh:mm:ss"],
      ["direction", "elapsed"],
      ["placement", "bottom-right"],
      ["size", "small"],
    ] as const) {
      const select = dialog.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;
      void act(() => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    type(dialog.querySelector<HTMLInputElement>("input[name=warningSeconds]")!, "60");
    void act(() => button(dialog, "Save").click());
    void act(() => labeled(host, "Show timer on air").click());
    expect(commands(live).map((sent) => liveRoomClientMessageSchema.parse(sent))).toEqual([
      {
        type: "stage.timer",
        visible: true,
        timer: {
          ...defaultLiveTimerGraphic("session"),
          label: "Time left",
          format: "hh:mm:ss",
          direction: "elapsed",
          placement: "bottom-right",
          size: "small",
          warningSeconds: 60,
        },
      },
    ]);
  });

  it("refuses a countdown to a time without its time, as the contract does", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR }), "stage");
    const time = panel(host, "Time");
    void act(() => labeled(time, "Add timer").click());
    type(time.querySelector<HTMLInputElement>("input[name=name]")!, "Doors");
    const kind = time.querySelector<HTMLSelectElement>("select[name=kind]")!;
    void act(() => {
      kind.value = "until";
      kind.dispatchEvent(new Event("change", { bubbles: true }));
    });
    void act(() => button(time, "Add timer").click());
    expect(time.textContent).toContain("Enter the time it counts down to.");
    expect(commands(live)).toEqual([]);
  });

  it("pictures a question's asker only when they asked by name and have a photo", () => {
    const photo = "/api/v1/users/u1/headshots/portrait.jpg";
    const { host } = mountDesk(
      liveSnapshot({
        viewer: OPERATOR,
        questions: [
          liveQuestion({ authorPhotoUrl: photo }),
          liveQuestion({
            id: "20000000-0000-4000-8000-000000000009",
            anonymous: true,
            authorName: "Ada Attendee",
            authorPhotoUrl: null,
          }),
        ],
      }),
    );
    const questions = panel(host, "Questions");
    const pictured = [...questions.querySelectorAll<HTMLImageElement>(".pk-live-question img")];
    expect(pictured).toHaveLength(1);
    expect(pictured[0]!.closest(".pk-live-question")?.textContent).toContain("Bea Attendee");
  });

  it("keeps a message flashing until an operator stops it from the on-stage footer", () => {
    const { host, live } = mountDesk(
      liveSnapshot({
        viewer: OPERATOR,
        speakerMessage: { text: "Please wrap up", tone: "warning", flash: true, change: null },
      }),
      "stage",
    );
    const message = panel(host, "Message to speaker");
    const stop = button(message, "Stop flashing");
    expect(stop.getAttribute("aria-pressed")).toBe("true");
    void act(() => stop.click());
    expect(commands(live).map((sent) => liveRoomClientMessageSchema.parse(sent))).toEqual([
      { type: "speaker.message", text: "Please wrap up", tone: "warning", flash: false },
    ]);
  });

  it("keeps every composer change a draft until Send or Update, and acts on the stage only from its footer", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR }), "stage");
    const message = panel(host, "Message to speaker");
    const sent = () => commands(live).map((command) => liveRoomClientMessageSchema.parse(command));
    void act(() => button(message, "Send to stage").click());
    expect(message.querySelector(".pk-field__message")?.textContent).toContain("Write a message for the speaker.");
    // A ready-made message only fills the draft, with its tone.
    void act(() => button(message, "Please wrap up").click());
    expect(message.querySelector<HTMLInputElement>("input[name=text]")!.value).toBe("Please wrap up");
    expect(sent()).toEqual([]);
    type(message.querySelector<HTMLInputElement>("input[name=text]")!, "Two more questions");
    const flash = [...message.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((box) =>
      box.closest("label")?.textContent?.startsWith("Flash"),
    )!;
    void act(() => flash.click());
    void act(() => button(message, "Send to stage").click());
    void act(() =>
      live.latest().deliver({
        type: "speaker.message.changed",
        speakerMessage: { text: "Two more questions", tone: "warning", flash: true, change: null },
      }),
    );
    expect(message.textContent).toContain("On stage");
    // A tone picked while a message shows waits for Update, like every other change in the composer.
    void act(() => button(message, "Edit").click());
    void act(() => button(message, "Urgent").click());
    expect(sent()).toHaveLength(1);
    void act(() => button(message, "Update message").click());
    void act(() => button(message, "Stop flashing").click());
    void act(() => button(message, "Clear from stage").click());
    expect(sent()).toEqual([
      { type: "speaker.message", text: "Two more questions", tone: "warning", flash: true },
      { type: "speaker.message", text: "Two more questions", tone: "urgent", flash: true },
      { type: "speaker.message", text: "Two more questions", tone: "warning", flash: false },
      { type: "speaker.message", text: null, tone: "warning", flash: false },
    ]);
  });

  it("prepares a poll with the forms question editor, through the poll contract, and opens it", () => {
    const { host, live } = mountDesk();
    void act(() => host.querySelector<HTMLButtonElement>("button[aria-label='New poll']")!.click());
    type(
      host.querySelector<HTMLInputElement>("input[placeholder='What are you asking?']")!,
      "Which migration comes first?",
    );
    type(host.querySelector<HTMLInputElement>("input[aria-label='Choice 1']")!, "Root CA");
    void act(() => button(host, "Add poll").click());
    expect(commands(live)).toEqual([]);
    type(host.querySelector<HTMLInputElement>("input[aria-label='Choice 2']")!, "TLS endpoints");
    void act(() => button(host, "Add poll").click());
    void act(() =>
      live
        .latest()
        .deliver({ type: "poll.changed", poll: livePoll({ status: "draft", results: livePollResults({}) }) }),
    );
    void act(() => button(host, "Open voting").click());
    const [saved, opened] = commands(live);
    expect(saved).toMatchObject({ type: "poll.save", pollId: null, draft: { field: { fieldType: "select" } } });
    expect(opened).toEqual({ type: "poll.status", pollId: LIVE_POLL, status: "open" });
  });

  it("shows the other operators in the header, named in plain text", () => {
    const { host } = mountDesk(
      liveSnapshot({
        viewer: OPERATOR,
        operators: [
          { name: "Olga Operator", connections: 1 },
          { name: "Remote Rita", connections: 2 },
        ],
      }),
    );
    const operators = host.querySelector('.pk-studio-header [aria-label="Operating now"]');
    expect([...operators!.querySelectorAll(".pk-sr-only")].map((name) => name.textContent)).toEqual([
      "Remote Rita (2 control rooms)",
    ]);
  });
});

describe("live control room states", () => {
  it("pauses its controls while the room reconnects", () => {
    const { host, live } = mountDesk();
    void act(() => live.latest().close());
    expect(host.textContent).toContain("Reconnecting to the live room");
    expect(labeled(host, "Prepare Sam Speaker in Preview").disabled).toBe(true);
  });

  it("says what failed when the room refuses the session, and does not retry", () => {
    const { host, live } = mountClosedDesk();
    vi.useFakeTimers();
    try {
      void act(() => live.latest().refuse(4404, "LIVE_SESSION_NOT_FOUND"));
      vi.advanceTimersByTime(60_000);
    } finally {
      vi.useRealTimers();
    }
    expect(host.textContent).toContain("This session has no live room yet.");
    expect(live.sockets).toHaveLength(1);
  });

  it("names missing access only when the room says so", () => {
    expect(liveRoomOpenFailure("LIVE_SESSION_ACCESS_REQUIRED", "operator")).toContain("live moderation access");
    expect(liveRoomOpenFailure(null, "operator")).toContain("can't be reached");
  });
});
