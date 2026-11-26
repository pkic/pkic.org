// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../../assets/shared/schemas/live-session-graphic-settings";
import { liveRoomClientMessageSchema, type LiveRoomClientMessage } from "../../assets/shared/schemas/live-session-room";
import { LiveCheckInControls } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveCheckInControls";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { LIVE_OCCURRENCE, liveSnapshot } from "./helpers/live-room-socket";
import { button, labeled, type } from "./helpers/live-desk";

vi.mock("../../assets/ts/hooks/useData", () => ({
  useData: () => ({
    data: [
      {
        selection: { kind: "session", occurrenceId: LIVE_OCCURRENCE },
        label: "This session",
        path: "/portal/#/events/pqc-2026/check-in/signed",
      },
    ],
    loading: false,
  }),
}));

const host = document.createElement("div");
afterEach(() => {
  render(null, host);
  host.remove();
});

it("validates the instruction, saves its visibility and sends both through the canonical room command", async () => {
  document.body.append(host);
  const sendProgram = vi.fn<(message: LiveRoomClientMessage) => boolean>(() => true);
  const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } }))!;
  /** The row's settings, in its menu like a timer's. */
  const openSettings = () => {
    void act(() => labeled(host!, "Check-in code actions").click());
    void act(() =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.includes("Check-in code settings"))!
        .click(),
    );
  };
  void act(() =>
    render(
      <LiveCheckInControls
        slug="pqc-2026"
        occurrenceId={LIVE_OCCURRENCE}
        targets={{ state, programActive: true, disabled: false, sendProgram }}
      />,
      host,
    ),
  );
  openSettings();
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
  const instruction = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(instruction.value).toBe(DEFAULT_LIVE_CHECK_IN_TEXT.template);
  type(instruction, "{{#unclosed}}");
  void act(() => button(dialog, "Save").click());
  expect(instruction.getAttribute("aria-invalid")).toBe("true");
  expect(dialog.open).toBe(true);
  const template = "{{#checkIn.label}}**{{checkIn.label}}**{{/checkIn.label}}";
  type(instruction, template);
  void act(() => dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => button(dialog, "Save").click());
  expect(document.querySelector("dialog[open]")).toBeNull();
  void act(() => labeled(host, "Show check-in code on air").click());
  expect(liveRoomClientMessageSchema.parse(sendProgram.mock.calls[0]?.[0])).toMatchObject({
    type: "stage.set",
    checkIn: { kind: "session", occurrenceId: LIVE_OCCURRENCE },
    checkInText: { visible: false, template },
  });
  openSettings();
  const reopened = document.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(reopened.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(template);
  expect(reopened.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
});

it("saves the look and instruction for the event, and keeps the dialog open when the save fails", async () => {
  document.body.append(host);
  const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } }))!;
  const saveGraphic = vi.fn(async () => "The studio setup was not saved." as string | null);
  const setup = {
    graphics: {
      checkIn: { theme: "white-on-black" as const, text: { ...DEFAULT_LIVE_CHECK_IN_TEXT, visible: false } },
    },
    layouts: {},
    canSave: true,
    saveGraphic,
    saveLayout: vi.fn(async () => null),
  };
  void act(() =>
    render(
      <LiveCheckInControls
        slug="pqc-2026"
        occurrenceId={LIVE_OCCURRENCE}
        targets={{ state, programActive: true, disabled: false, sendProgram: () => true, setup }}
      />,
      host,
    ),
  );
  void act(() => labeled(host, "Check-in code actions").click());
  void act(() =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes("Check-in code settings"))!
      .click(),
  );
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(dialog.textContent).toContain("Every room of the event starts from this look and instruction.");
  expect(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  await act(async () => button(dialog, "Save").click());
  expect(saveGraphic).toHaveBeenCalledWith("checkIn", setup.graphics.checkIn);
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain("The studio setup was not saved.");
  saveGraphic.mockResolvedValueOnce(null);
  await act(async () => button(dialog, "Save").click());
  expect(document.querySelector("dialog[open]")).toBeNull();
});

it("ignores a save the operator cancelled, so it neither reports into nor closes the dialog opened after it", async () => {
  document.body.append(host);
  const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } }))!;
  let finish: (problem: string | null) => void = () => undefined;
  const saveGraphic = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
  const setup = { graphics: {}, layouts: {}, canSave: true, saveGraphic, saveLayout: vi.fn(async () => null) };
  void act(() =>
    render(
      <LiveCheckInControls
        slug="pqc-2026"
        occurrenceId={LIVE_OCCURRENCE}
        targets={{ state, programActive: true, disabled: false, sendProgram: () => true, setup }}
      />,
      host,
    ),
  );
  const openSettings = () => {
    void act(() => labeled(host, "Check-in code actions").click());
    void act(() =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.includes("Check-in code settings"))!
        .click(),
    );
    return document.querySelector<HTMLDialogElement>("dialog[open]")!;
  };
  const first = openSettings();
  await act(async () => button(first, "Save").click());
  void act(() => button(first, "Cancel").click());
  const second = openSettings();
  await act(async () => finish("The studio setup was not saved."));
  expect(second.open).toBe(true);
  expect(second.textContent).not.toContain("The studio setup was not saved.");
});
