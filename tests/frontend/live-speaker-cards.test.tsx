// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { LiveRoomClientMessage } from "../../assets/shared/schemas/live-session-room";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  liveCreditSchema,
  liveRoomClientMessageSchema,
} from "../../assets/shared/schemas/live-session-room";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import {
  LiveAddPersonAction,
  LiveSpeakerCards,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveSpeakerCards";
import { liveSnapshot, liveTargets } from "./helpers/live-room-socket";
import { addedLivePersonKey } from "../../assets/shared/live-room-credits";
import { getJson } from "../../assets/ts/shared/api-client";

vi.mock("../../assets/ts/shared/api-client", async (original) => ({
  ...(await original<typeof import("../../assets/ts/shared/api-client")>()),
  getJson: vi.fn(),
}));

let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
});

function roomState() {
  const state = applyLiveRoomMessage(null, liveSnapshot());
  if (!state) throw new Error("Expected the canonical room snapshot");
  return state;
}

it("shows a speaker as the identity they act as, and lines them up in Preview from the row", async () => {
  const state = roomState();
  const credit = liveCreditSchema.parse({
    key: "speaker:approved",
    name: "Approved Speaker",
    moderator: true,
    roleLabel: "Moderator",
    photoUrl: "/approved.webp",
    identity: { title: "Approved Chair", organization: "Approved Organization" },
  });
  state.session.credits = [credit];
  const sendProgram = vi.fn((_message: LiveRoomClientMessage) => true);
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveSpeakerCards targets={liveTargets(state, { sendProgram })} />, host!));
  const row = host.querySelector<HTMLButtonElement>('button[aria-label="Prepare Approved Speaker in Preview"]')!;
  expect(row.getAttribute("aria-pressed")).toBe("false");
  expect(row.textContent).toBe("Approved SpeakerModeratorApproved Chair at Approved Organization");
  row.click();
  expect(liveRoomClientMessageSchema.parse(sendProgram.mock.calls[0]![0])).toEqual({
    type: "preview.set",
    composition: { creditKey: credit.key, lowerThirdMotion: "animated" },
  });
});

it("shows a person's card with a large portrait on focus and on a tap of their photo", async () => {
  const state = roomState();
  state.session.credits = [
    liveCreditSchema.parse({
      key: "speaker:approved",
      name: "Approved Speaker",
      moderator: true,
      roleLabel: "Moderator",
      photoUrl: "/approved.webp",
      identity: { title: "Approved Chair", organization: "Approved Organization" },
    }),
  ];
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveSpeakerCards targets={liveTargets(state)} />, host!));
  const row = host.querySelector<HTMLButtonElement>('button[aria-label="Prepare Approved Speaker in Preview"]')!;
  await act(async () => row.focus());
  const card = host.querySelector<HTMLElement>('[role="dialog"][aria-label="About Approved Speaker"]')!;
  // The portrait fills the card, as on the agenda's speaker directory.
  expect(card.querySelector(".pk-agenda-speaker-directory__card > .pk-avatar--xl img")?.getAttribute("src")).toContain(
    "approved",
  );
  expect(card.textContent).toContain("Approved Chair");
  expect(card.textContent).toContain("Approved Organization");
  expect(card.querySelector(".pk-live-person-card__role")?.textContent).toBe("Moderator in this session");
  // Escape closes the card and nothing around it, such as the studio's full screen.
  const around = vi.fn();
  document.addEventListener("keydown", around);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => {
    row.dispatchEvent(escape);
  });
  document.removeEventListener("keydown", around);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(escape.defaultPrevented).toBe(true);
  expect(around).not.toHaveBeenCalled();

  const photo = host.querySelector<HTMLButtonElement>(".pk-live-person__photo")!;
  const tap = () =>
    act(async () => {
      photo.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
      photo.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
  await tap();
  expect(photo.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector('[role="dialog"]')?.id).toBe(photo.getAttribute("aria-controls"));
  await tap();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("shows each destination's state on the row edge and toggles Program and an aux output on their own", async () => {
  const state = roomState();
  const credit = state.session.credits[0]!;
  state.stage = { ...state.stage, lowerThird: credit };
  const sendProgram = vi.fn((_message: LiveRoomClientMessage) => true);
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveSpeakerCards targets={liveTargets(state, { sendProgram })} />, host!));
  expect(host.querySelector(".pk-live-person")!.getAttribute("data-on-air")).toBe("program");
  const program = host.querySelector<HTMLButtonElement>(`button[aria-label="Show ${credit.name} on air"]`)!;
  expect(program.getAttribute("aria-pressed")).toBe("true");
  program.click();
  expect(sendProgram).toHaveBeenLastCalledWith({ type: "stage.lowerThird", creditKey: null, motion: "animated" });
  await act(() =>
    host!.querySelector<HTMLButtonElement>(`button[aria-label="Send ${credit.name} to the room's screens"]`)!.click(),
  );
  const projector = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find((item) =>
    item.textContent?.includes("Projector"),
  )!;
  expect(projector.getAttribute("aria-checked")).toBe("false");
  await act(() => projector.click());
  const aux = liveRoomClientMessageSchema.parse(sendProgram.mock.calls.at(-1)![0]);
  expect(aux).toMatchObject({
    type: "aux.set",
    output: "projector",
    composition: { creditKey: credit.key, lowerThirdMotion: "animated" },
  });
  expect(sendProgram.mock.calls.some(([message]) => message.type === "preview.set")).toBe(false);
});

it("does not show Program as pressed while another session is on air, and puts the speaker on with the first press", async () => {
  const state = roomState();
  const credit = state.session.credits[0]!;
  state.stage = { ...state.stage, lowerThird: credit };
  state.outputs = { ...state.outputs, "stage-preview": { ...EMPTY_LIVE_AUX_COMPOSITION, lowerThird: credit } };
  const sendProgram = vi.fn((_message: LiveRoomClientMessage) => true);
  host = document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(<LiveSpeakerCards targets={liveTargets(state, { programActive: false, sendProgram })} />, host!),
  );
  const program = host.querySelector<HTMLButtonElement>(`button[aria-label="Show ${credit.name} on air"]`)!;
  expect(program.getAttribute("aria-pressed")).toBe("false");
  program.click();
  expect(sendProgram).toHaveBeenCalledWith({ type: "stage.lowerThird", creditKey: credit.key, motion: "animated" });
});

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("groups the host and moderator after the speakers, each named by their role", async () => {
  const state = roomState();
  const role = (key: string, name: string, roleLabel: string) =>
    liveCreditSchema.parse({ key, name, roleLabel, moderator: roleLabel === "Moderator" });
  state.session.credits = [
    ...state.session.credits,
    role("host:hana", "Hana Host", "Host"),
    role("user:mo", "Mo Moderator", "Moderator"),
  ];
  const sendProgram = vi.fn((_message: LiveRoomClientMessage) => true);
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveSpeakerCards targets={liveTargets(state, { sendProgram })} />, host!));
  expect([...host.querySelectorAll(".pk-live-people__heading")].map((heading) => heading.textContent)).toEqual([
    "Host and moderator",
  ]);
  // The Speakers panel's own title names the first group, so it has no heading of its own.
  expect(host.querySelector('section[aria-label="Speakers"]')).not.toBeNull();
  const rows = [...host.querySelectorAll('[aria-label="Host and moderator"] li')];
  expect(rows.map((row) => row.querySelector(".pk-live-person__text")?.textContent)).toEqual([
    "Hana HostHost",
    "Mo ModeratorModerator",
  ]);
  host.querySelector<HTMLButtonElement>('button[aria-label="Prepare Hana Host in Preview"]')!.click();
  expect(liveRoomClientMessageSchema.parse(sendProgram.mock.calls.at(-1)![0])).toEqual({
    type: "preview.set",
    composition: { creditKey: "host:hana", lowerThirdMotion: "animated" },
  });
});

it("adds someone without an account by name alone, never a typed title, and removes an added one", async () => {
  const state = roomState();
  state.addedCredits = [
    liveCreditSchema.parse({
      key: "added:1",
      name: "Grace Guest",
      identity: { title: "Engineer", organization: "Lattice Labs" },
    }),
  ];
  const sendProgram = vi.fn((_message: LiveRoomClientMessage) => true);
  host = document.body.appendChild(document.createElement("div"));
  const targets = liveTargets(state, { sendProgram });
  await act(() =>
    render(
      <>
        <LiveAddPersonAction targets={targets} slug="pqc-2026" />
        <LiveSpeakerCards targets={targets} />
      </>,
      host!,
    ),
  );
  expect(host.querySelector('[aria-label="Added for this session"]')?.textContent).toContain(
    "Engineer at Lattice Labs",
  );
  host.querySelector<HTMLButtonElement>('button[aria-label="Remove Grace Guest"]')!.click();
  expect(liveRoomClientMessageSchema.parse(sendProgram.mock.calls.at(-1)![0])).toEqual({
    type: "credit.remove",
    creditKey: "added:1",
  });

  await act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Add person"]')!.click());
  const dialog = document.querySelector("dialog")!;
  expect(dialog.querySelector("input[name=title]")).toBeNull();
  const confirm = () =>
    [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add person")!.click();
  await act(() => confirm());
  expect(dialog.textContent).toContain("Enter a name.");
  await act(() => typeInto(dialog.querySelector<HTMLInputElement>("input[name=name]")!, "Pat Presenter"));
  await act(() => confirm());
  expect(liveRoomClientMessageSchema.parse(sendProgram.mock.calls.at(-1)![0])).toEqual({
    type: "credit.add",
    person: { userId: null, identityId: null, name: "Pat Presenter" },
  });
});

it("finds each identity of a person as its own result and adds the one picked", async () => {
  vi.useFakeTimers();
  vi.mocked(getJson).mockResolvedValue({
    identities: [
      {
        userId: "7b0c9d5e-1a2b-4c3d-8e4f-5a6b7c8d9e01",
        identityId: "7b0c9d5e-1a2b-4c3d-8e4f-5a6b7c8d9f01",
        name: "Cleo Chair",
        photoUrl: null,
        title: "Vice Chair",
        organization: "Northwind Trust",
      },
      {
        userId: "7b0c9d5e-1a2b-4c3d-8e4f-5a6b7c8d9e01",
        identityId: "7b0c9d5e-1a2b-4c3d-8e4f-5a6b7c8d9f02",
        name: "Cleo Chair",
        photoUrl: null,
        title: "Policy Authority",
        organization: "Example Agency",
      },
    ],
    page: { limit: 8, offset: 0, total: 2, hasMore: false },
  });
  const state = roomState();
  // Cleo is already in the session as her Northwind identity.
  state.addedCredits = [
    liveCreditSchema.parse({
      key: addedLivePersonKey("7b0c9d5e-1a2b-4c3d-8e4f-5a6b7c8d9e01", "7b0c9d5e-1a2b-4c3d-8e4f-5a6b7c8d9f01"),
      name: "Cleo Chair",
    }),
  ];
  const sendProgram = vi.fn((_message: LiveRoomClientMessage) => true);
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveAddPersonAction targets={liveTargets(state, { sendProgram })} slug="pqc-2026" />, host!));
  await act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Add person"]')!.click());
  const dialog = document.querySelector("dialog")!;
  const search = dialog.querySelector<HTMLInputElement>('input[placeholder="Name or organization"]')!;
  await act(() => typeInto(search, "cleo"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  vi.useRealTimers();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const results = [...dialog.querySelectorAll<HTMLButtonElement>('[aria-label="Matching people"] button')];
  expect(results.map((result) => result.textContent)).toEqual([
    "CCCleo ChairVice Chair at Northwind Trust · Already in this session",
    "CCCleo ChairPolicy Authority at Example Agency",
  ]);
  expect(results.map((result) => result.disabled)).toEqual([true, false]);
  // Hovering a result shows who it is before it is picked.
  const preview = results[1]!.closest<HTMLElement>(".pk-live-person-preview")!;
  await act(async () => {
    preview.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
  });
  const card = document.querySelector<HTMLElement>('[role="dialog"][aria-label="About Cleo Chair"]')!;
  expect(card.textContent).toContain("Policy Authority");
  expect(card.textContent).toContain("Example Agency");
  expect(card.querySelector(".pk-avatar--xl")).not.toBeNull();
  await act(() => results[1]!.click());
  expect(search.value).toBe("Cleo Chair · Policy Authority at Example Agency");
  await act(() =>
    [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add person")!.click(),
  );
  expect(liveRoomClientMessageSchema.parse(sendProgram.mock.calls.at(-1)![0])).toEqual({
    type: "credit.add",
    person: {
      userId: "7b0c9d5e-1a2b-4c3d-8e4f-5a6b7c8d9e01",
      identityId: "7b0c9d5e-1a2b-4c3d-8e4f-5a6b7c8d9f02",
      name: "Cleo Chair",
    },
  });
});

it("reads credits a room stored before identities, dropping their copied title", () => {
  const credit = liveCreditSchema.parse({
    key: "old",
    name: "Old credit",
    title: "Copied title",
    affiliations: ["Copied title"],
    directoryAffiliations: [],
  });
  expect(credit).toEqual({
    key: "old",
    name: "Old credit",
    moderator: false,
    photoUrl: null,
    identity: null,
    roleLabel: null,
  });
});
