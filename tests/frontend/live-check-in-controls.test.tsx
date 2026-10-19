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

it("validates the instruction, saves its visibility and sends both through the canonical room command", () => {
  document.body.append(host);
  const sendProgram = vi.fn<(message: LiveRoomClientMessage) => boolean>(() => true);
  const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } }))!;
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
  void act(() => labeled(host, "Check-in code settings").click());
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
  void act(() => button(dialog, "Save").click());
  expect(document.querySelector("dialog[open]")).toBeNull();
  void act(() => labeled(host, "Show check-in code on air").click());
  expect(liveRoomClientMessageSchema.parse(sendProgram.mock.calls[0]?.[0])).toMatchObject({
    type: "stage.set",
    checkIn: { kind: "session", occurrenceId: LIVE_OCCURRENCE },
    checkInText: { visible: false, template },
  });
  void act(() => labeled(host, "Check-in code settings").click());
  const reopened = document.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(reopened.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(template);
  expect(reopened.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
});
