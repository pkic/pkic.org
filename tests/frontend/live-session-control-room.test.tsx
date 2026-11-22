import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../../assets/shared/schemas/live-session-graphic-settings";
import { DEFAULT_LIVE_ROOM_OUTPUTS } from "../../assets/shared/schemas/live-room-output-setup";
import { LIVE_GRAPHIC_THEME_DEFAULTS } from "../../assets/shared/live-graphic-theme";
// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
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
  menuItem,
  mountDesk,
  panel,
  resetDeskStorage,
  take,
  type,
  unmountDesks,
} from "./helpers/live-desk";

beforeEach(resetDeskStorage);
afterEach(unmountDesks);

/** Elements a browser would give its own title bubble; an iframe's title is its name, not a hint. */
const nativeTitles = () => [...document.querySelectorAll("[title]")].filter((element) => element.tagName !== "IFRAME");

describe("live control room hints", () => {
  it("leaves no native title on the desk, in a row's menu or in a dialog it opens", async () => {
    const { host } = mountDesk();
    await act(async () => undefined);
    expect(nativeTitles()).toEqual([]);
    // PVW and PGM carry a hint that leads with the state and says what a click does.
    expect(labeled(host, "Show Sam Speaker on air").dataset.tooltip).toBe(
      "Off air\nClick to put it on air now. Preview is not needed first.",
    );
    await act(async () => labeled(host, "Sam Speaker actions").click());
    expect(document.querySelector("[role='menu']")).not.toBeNull();
    expect(nativeTitles()).toEqual([]);
    await act(async () => menuItem(document, "Projector").click());
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => labeled(host, "Prepare question").click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Prepare question");
    expect(nativeTitles()).toEqual([]);
    // A panel's icon controls say what they do, not only their names.
    expect(labeled(host, "Close Speakers").dataset.tooltip).toBe(
      "Close Speakers\nTake this panel off the workspace. Nothing on air changes, and Add panel brings it back.",
    );
    expect(labeled(host, "Close Speakers").getAttribute("aria-description")).toBe(
      "Take this panel off the workspace. Nothing on air changes, and Add panel brings it back.",
    );
  });
});

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

  it("transitions Preview to a screen from that screen's own take button", () => {
    const base = liveSnapshot({ viewer: OPERATOR });
    // Every screen gets a take button, the projector that follows Program too.
    const snapshot = liveSnapshot({
      viewer: OPERATOR,
      session: {
        ...base.session,
        roomOutputs: [
          ...DEFAULT_LIVE_ROOM_OUTPUTS,
          { key: "foy", name: "Foyer", code: "FOY", role: "exact", scene: null, sceneLocked: false },
        ],
      },
    });
    const { host, live } = mountDesk(snapshot);
    const credit = snapshot.session.credits[0]!;
    expect(
      [...host.querySelectorAll(".pk-studio-transition button")].map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Transition to Program", "Transition to Projector", "Transition to Foyer"]);
    void act(() =>
      live.latest().deliver({ type: "preview.changed", composition: { ...snapshot.preview, lowerThird: credit } }),
    );
    // A screen that shows what you take to it takes the whole shot, picks included.
    void act(() => take(host, "Foyer").click());
    const sent = liveRoomClientMessageSchema.parse(commands(live).at(-1));
    expect(sent).toMatchObject({ type: "aux.set", output: "foy", composition: { creditKey: credit.key } });
  });

  it("takes Preview exactly to a screen that follows Program, and to one whose sync is off", () => {
    const { host, live } = mountDesk();
    const snapshot = liveSnapshot({ viewer: OPERATOR });
    // A title just written is the current one; the tooltip layer moves it into the hint a moment later.
    const hint = (output: string) => take(host, output).getAttribute("title") ?? take(host, output).dataset.tooltip;
    const timer = defaultLiveTimerGraphic("session");
    // The Panel scene, its panel, a question and a timer wait on Preview only.
    void act(() =>
      live.latest().deliver({
        type: "preview.changed",
        composition: {
          ...snapshot.preview,
          scene: "panel",
          panelists: { layout: "panel" },
          question: {
            id: LIVE_QUESTION,
            text: "How do we inventory our certificates?",
            authorName: null,
            authorPhotoUrl: null,
            authorAffiliation: null,
            addressedTo: null,
          },
          timerGraphics: [timer],
        },
      }),
    );
    // The take sends the whole shot: scene, picks and switches, so the projector shows what Preview shows.
    const whole = {
      type: "aux.set",
      output: "projector",
      composition: {
        scene: "panel",
        panelists: { layout: "panel" },
        questionId: LIVE_QUESTION,
        timerGraphics: [timer],
      },
    };
    expect(hint("Projector")).toBe(
      "Transition to Projector\nShow Preview on Projector, exactly as it is. After that, what you change on Program changes on Projector too.",
    );
    void act(() => take(host, "Projector").click());
    expect(liveRoomClientMessageSchema.parse(commands(live).at(-1))).toMatchObject(whole);
    // The speaker's screen draws its own fixed layout, so there is no Transition to it.
    expect(host.querySelector('button[aria-label="Transition to Stage display"]')).toBeNull();
    // With its sync off, the projector takes the same shot and then stays as it is.
    void act(() => live.latest().deliver({ type: "screen.sync.changed", screenSync: { projector: false } }));
    expect(hint("Projector")).toBe(
      "Transition to Projector\nShow Preview on Projector, exactly as it is. Program stays as it is.",
    );
    void act(() => take(host, "Projector").click());
    expect(liveRoomClientMessageSchema.parse(commands(live).at(-1))).toMatchObject(whole);
  });

  it("clears the shared Preview from its monitor to a blank frame in the Default scene", () => {
    const { host, live } = mountDesk();
    const snapshot = liveSnapshot({ viewer: OPERATOR });
    void act(() =>
      live.latest().deliver({
        type: "preview.changed",
        composition: {
          ...snapshot.preview,
          lowerThird: snapshot.session.credits[0]!,
          timerGraphics: [defaultLiveTimerGraphic("session")],
          scene: "questions",
        },
      }),
    );
    // The hint says what a click does: everything off, and back to the scene that brings nothing on.
    const clear = labeled(host, "Clear Preview");
    expect(clear.dataset.tooltip ?? clear.getAttribute("title")).toBe(
      "Clear Preview\nTake everything off Preview and go back to the Default scene.",
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
          checkInTheme: LIVE_GRAPHIC_THEME_DEFAULTS.checkIn,
          checkInText: DEFAULT_LIVE_CHECK_IN_TEXT,
          lowerThirdMotion: "animated",
          timerGraphics: [],
          topQuestions: null,
          chatFeed: null,
          reactions: false,
          reactionsGraphic: { showCount: false },
          // No scene is the Default one: every graphic off, in the scene that brings nothing on.
          scene: null,
        },
      },
    ]);
  });

  it("shows the scenes under Preview, hides them from its panel menu, and loads one into Preview", () => {
    const { host, live } = mountDesk();
    expect(panel(host, "Preview").querySelector(".pk-studio-scenes")).not.toBeNull();
    void act(() => labeled(panel(host, "Preview"), "Preview panel").click());
    void act(() => menuItem(document.body, "Hide scenes").click());
    expect(panel(host, "Preview").querySelector(".pk-studio-scenes")).toBeNull();
    void act(() => labeled(panel(host, "Preview"), "Preview panel").click());
    void act(() => menuItem(document.body, "Show scenes").click());
    const strip = panel(host, "Preview").querySelector<HTMLElement>(
      '[role="group"][aria-label="Load a scene into Preview"]',
    );
    expect(strip).not.toBeNull();
    const scenes = [...strip!.querySelectorAll<HTMLButtonElement>("button")];
    expect(scenes.map((scene) => scene.querySelector(".pk-studio-scene__name")?.textContent)).toEqual([
      "Default",
      "Q&A",
      "Panel",
      "Break",
      "Check-in",
      "Full board",
    ]);
    expect(scenes.filter((scene) => scene.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    // Each scene is drawn live, with the same renderer as the monitors.
    expect(scenes.every((scene) => scene.querySelector(".pk-studio-scene__picture .pk-live-overlay"))).toBe(true);
    // A scene lays out what Preview holds and adds only what comes on with it: no scene picks a lower third,
    // and Default, which brings nothing on, shows an empty Preview as its faint boxes.
    expect(scenes.some((scene) => scene.querySelector(".pk-live-overlay__name"))).toBe(false);
    expect(scenes[0]!.querySelector(".pk-studio-scene__outline rect")).not.toBeNull();
    // Every output draws Default here, so Default carries a marker for each, Program's first.
    expect(
      [...scenes[0]!.querySelectorAll(".pk-studio-scene__marker")].map((marker) => marker.getAttribute("aria-label")),
    ).toEqual(["On Program", "In Preview", "On Projector"]);
    expect(scenes.slice(1).some((scene) => scene.querySelector(".pk-studio-scene__marker"))).toBe(false);
    expect(panel(host, "Preview").querySelector(".pk-studio-monitor__screen .pk-live-overlay__name")).toBeNull();
    const next = scenes.find((scene) => scene.getAttribute("aria-pressed") === "false")!;
    void act(() => next.click());
    const sent = liveRoomClientMessageSchema.parse(commands(live).at(-1));
    expect(sent).toMatchObject({ type: "preview.set", composition: { scene: expect.any(String) } });
    // The hint names the scene and its state, then what choosing it does; the studio's tooltip shows it.
    expect(next.dataset.tooltip ?? next.getAttribute("title")).toContain("into Preview");
  });

  it("puts the timer on the shared Preview and toggles it on Program directly", () => {
    const { host, live } = mountDesk(undefined, "stage");
    void act(() => labeled(host, "Show Session timer in preview").click());
    void act(() => labeled(host, "Show Session timer on air").click());
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

  it("moderates a submitted question, puts an approved one on Program, marks it discussed, reopens it and shows a hidden one again", async () => {
    const pending = liveQuestion({ status: "pending", votes: 0, anonymous: true, authorName: "Ada Attendee" });
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [pending] }));
    const questions = panel(host, "Questions");
    expect(questions.textContent).toContain("Pending");
    expect(questions.textContent).toContain("1 open");
    void act(() => labeled(questions, "Approve").click());
    void act(() =>
      live.latest().deliver({
        type: "question.changed",
        question: liveQuestion({ anonymous: true, authorName: "Ada Attendee" }),
      }),
    );
    void act(() => labeled(questions, "Show question on air").click());
    // Mark discussed is in the row's menu only, so a slip of the hand on the row never closes a question.
    expect(questions.querySelector('button[aria-label="Mark discussed"]')).toBeNull();
    await act(async () => labeled(questions, "Question actions").click());
    await act(async () => menuItem(document, "Mark discussed").click());
    expect(commands(live)).toEqual([
      { type: "question.moderate", questionId: LIVE_QUESTION, expectedRevision: 0, status: "approved" },
      { type: "stage.question", questionId: LIVE_QUESTION },
      { type: "question.moderate", questionId: LIVE_QUESTION, expectedRevision: 0, status: "answered" },
    ]);
    // A discussed question leaves the open ones for the Discussed tab, where Reopen brings it back.
    void act(() =>
      live.latest().deliver({ type: "question.changed", question: liveQuestion({ status: "answered", revision: 1 }) }),
    );
    expect(questions.textContent).toContain("0 open");
    const discussed = questions.querySelector<HTMLElement>("#studio-questions-discussed")!;
    expect(discussed.textContent).toBe("Discussed · 1");
    void act(() => discussed.click());
    expect(questions.querySelector("#studio-questions-panel-discussed")?.hasAttribute("hidden")).toBe(false);
    void act(() => labeled(questions, "Reopen").click());
    expect(commands(live).at(-1)).toEqual({
      type: "question.moderate",
      questionId: LIVE_QUESTION,
      expectedRevision: 1,
      status: "approved",
    });
    // A question a moderator hid waits on the Hidden tab with the reason, and Show question brings it back.
    const removal = { reason: "spam" as const, at: new Date().toISOString(), byName: "Olga Operator" };
    void act(() =>
      live
        .latest()
        .deliver({ type: "question.changed", question: liveQuestion({ status: "hidden", revision: 2, removal }) }),
    );
    expect(questions.querySelector("#studio-questions-hidden")?.textContent).toBe("Hidden · 1");
    expect(questions.querySelector("#studio-questions-panel-hidden")?.textContent).toContain("Hidden by Olga Operator");
    void act(() => labeled(questions, "Show question").click());
    expect(commands(live).at(-1)).toMatchObject({ type: "question.moderate", expectedRevision: 2, status: "approved" });
  });

  it("prepares a question for a speaker, lists it under the open ones and releases it on demand", () => {
    const releaseAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const prepared = {
      id: "0123456789abcdef0123456789abcdef",
      text: "Where do we start?",
      addressedTo: "user:speaker",
      releaseAt,
      revision: 0,
    };
    const { host, live } = mountDesk();
    const questions = panel(host, "Questions");
    void act(() => questions.querySelector<HTMLButtonElement>("button[aria-label='Prepare question']")!.click());
    type(host.querySelector<HTMLTextAreaElement>("textarea[name=text]")!, "Where do we start?");
    const addressee = host.querySelector<HTMLSelectElement>("select[name=addressedTo]")!;
    void act(() => {
      addressee.value = "user:speaker";
      addressee.dispatchEvent(new Event("change", { bubbles: true }));
    });
    void act(() => button(host, "Prepare question").click());
    void act(() =>
      live.latest().deliver({
        type: "question.prepared.changed",
        preparedQuestions: [prepared],
        window: { from: new Date().toISOString(), until: releaseAt },
      }),
    );
    expect(questions.textContent).toContain("0 open · 1 prepared");
    expect(questions.textContent).toContain("For Sam Speaker");
    void act(() => labeled(questions, "Release now").click());
    expect(commands(live)).toEqual([
      { type: "question.prepare", preparedId: null, text: "Where do we start?", addressedTo: "user:speaker" },
      { type: "question.prepared.release", preparedId: "0123456789abcdef0123456789abcdef" },
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
    void act(() => labeled(host, "Close question").click());
    void act(() => labeled(host, "Question actions").click());
    void act(() => button(host, "Edit text").click());
    type(host.querySelector<HTMLTextAreaElement>("textarea[name=text]")!, "Should we deploy hybrid certificates?");
    void act(() => button(host, "Save text").click());
    // Opening the question followed its answers for as long as it was open.
    expect(commands(live).filter((command) => command.type !== "question.answers.watch")).toEqual([
      { type: "question.rewrite", questionId: LIVE_QUESTION, text: "Should we deploy hybrid certificates?" },
    ]);
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
    const pictured = [...questions.querySelectorAll<HTMLImageElement>(".pk-studio-row img")];
    expect(pictured).toHaveLength(1);
    expect(pictured[0]!.closest(".pk-studio-row")?.textContent).toContain("Bea Attendee");
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
