// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_LIVE_ROOM_OUTPUTS } from "../../assets/shared/schemas/live-room-output-setup";
import { LiveOverlayLinks } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveOverlayLinks";

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
  document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
  vi.unstubAllGlobals();
});

const SCENES = [
  { slug: "talk", name: "Talk" },
  { slug: "break", name: "Break" },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The room's API: a source token, and its screens as saved, which a PUT replaces as sent. */
function roomApi(outputs: unknown[] = [...DEFAULT_LIVE_ROOM_OUTPUTS]) {
  const saved = { outputs };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/live/overlays")) return json({ token: "signed", expiresAt: "2026-12-04T17:00:00.000Z" }, 201);
    if (url.endsWith("/live/outputs") && init?.method === "PUT") {
      const sent = JSON.parse(String(init.body)) as { outputs: Array<Record<string, unknown>> };
      saved.outputs = sent.outputs.map((output) => ({ key: output.key ?? "foy", ...output }));
      return json(saved);
    }
    if (url.endsWith("/live/outputs")) return json(saved);
    return json({ error: { message: "Not found" } }, 404);
  });
}

async function renderLinks() {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => render(<LiveOverlayLinks slug="pqc-2026" roomId="room-1" scenes={SCENES} />, host!));
  await vi.waitFor(() => expect(host!.querySelector("[data-copy-link-row]")).not.toBeNull());
}

const rowOf = (name: string) =>
  [...host!.querySelectorAll<HTMLTableRowElement>("tbody tr")].find((row) =>
    row.querySelector("td")?.textContent?.includes(name),
  )!;

const buttonIn = (root: ParentNode, text: string) =>
  [...root.querySelectorAll("button")].find((button) => button.textContent === text);

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("lists Program and the room's screens with their code, role, scene and a copy control", async () => {
  const fetch = roomApi();
  vi.stubGlobal("fetch", fetch);
  await renderLinks();
  // The token and the screens load together.
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(host!.textContent).toContain("Screens in this room");
  const program = rowOf("Program");
  expect(program.textContent).toContain("PGM");
  expect(program.textContent).toContain("Shows what you take to it");
  expect(program.textContent).toContain("From Preview");
  const projector = rowOf("Projector");
  expect(projector.textContent).toContain("Follow Program");
  expect(projector.textContent).toContain("From Program");
  expect(rowOf("Stage display").textContent).toContain("Fixed");
  // No long link fields until a copy fails.
  expect(host!.querySelector("[data-copy-link]")).toBeNull();
  expect(host!.querySelector('button[aria-label="Copy the Program link"]')).not.toBeNull();
  expect(host!.querySelector('button[aria-label="Copy the Projector link"]')).not.toBeNull();
  // The speaker's screen draws its own layout, so it has no graphics to narrow.
  expect(buttonIn(rowOf("Stage display"), "Show only some graphics…")).toBeUndefined();
  expect(buttonIn(rowOf("Projector"), "Show only some graphics…")).toBeDefined();
  expect(host!.textContent).toContain("These links stay the same");
});

it("offers Try again when the screens fail to load, and loads them on a retry", async () => {
  const api = roomApi();
  let failed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!failed) {
        failed = true;
        return json({ error: { message: "Unavailable" } }, 503);
      }
      return api(input, init);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => render(<LiveOverlayLinks slug="pqc-2026" roomId="room-1" scenes={SCENES} />, host!));
  const retry = await vi.waitFor(() => {
    const button = buttonIn(host!, "Try again");
    expect(button).toBeDefined();
    return button!;
  });
  await act(async () => retry.click());
  await vi.waitFor(() => expect(host!.querySelector("[data-copy-link-row]")).not.toBeNull());
});

it("adds a screen by saving the room's whole list, with the scene it always draws", async () => {
  const fetch = roomApi();
  vi.stubGlobal("fetch", fetch);
  await renderLinks();
  await act(async () => buttonIn(host!, "+ Add screen")!.click());
  const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
  await act(async () => type(dialog.querySelector<HTMLInputElement>('input[name="name"]')!, "Foyer"));
  await act(async () => type(dialog.querySelector<HTMLInputElement>('input[name="code"]')!, "foy"));
  // Another screen holds the speaker's role, so it stays closed.
  expect(dialog.querySelector<HTMLInputElement>('input[name="role"][value="speaker"]')!.disabled).toBe(true);
  const scene = dialog.querySelector<HTMLSelectElement>('select[name="scene"]')!;
  expect([...scene.options].map((option) => option.textContent)).toEqual([
    "From Preview",
    "Always Talk",
    "Always Break",
  ]);
  await act(async () => {
    scene.value = "break";
    scene.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => buttonIn(dialog, "Add screen")!.click());
  await vi.waitFor(() => expect(rowOf("Foyer")).toBeDefined());
  const put = fetch.mock.calls.find(([, init]) => init?.method === "PUT")!;
  expect(JSON.parse(String(put[1]!.body))).toEqual({
    outputs: [...DEFAULT_LIVE_ROOM_OUTPUTS, { name: "Foyer", code: "FOY", role: "exact", scene: "break" }],
  });
  expect(rowOf("Foyer").textContent).toContain("Break");
});

it("says on the field when a code is already in use, before anything is sent", async () => {
  const fetch = roomApi();
  vi.stubGlobal("fetch", fetch);
  await renderLinks();
  await act(async () => buttonIn(host!, "+ Add screen")!.click());
  const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
  await act(async () => type(dialog.querySelector<HTMLInputElement>('input[name="name"]')!, "Screen left"));
  await act(async () => type(dialog.querySelector<HTMLInputElement>('input[name="code"]')!, "PRJ"));
  await act(async () => buttonIn(dialog, "Add screen")!.click());
  expect(dialog.textContent).toContain("Another screen already uses this code.");
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("builds a link that shows only some graphics and crops to the one left", async () => {
  vi.stubGlobal("fetch", roomApi());
  await renderLinks();
  await act(async () => buttonIn(rowOf("Program"), "Show only some graphics…")!.click());
  const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
  const choice = (label: string) =>
    [...dialog.querySelectorAll<HTMLLabelElement>("label.pk-check")]
      .find((each) => each.textContent?.startsWith(label))!
      .querySelector("input")!;
  const link = () => dialog.querySelector<HTMLInputElement>("[data-copy-link]")!.value;
  expect(link()).not.toContain("show=");
  await act(async () => choice("Only these").click());
  await act(async () => choice("Check-in code").click());
  expect(choice("Crop to the graphic").disabled).toBe(false);
  await act(async () => choice("Crop to the graphic").click());
  expect(link()).toContain("#view=program&show=checkIn&crop&event=pqc-2026");
  // A second graphic leaves more than one, so the link drops crop until one is left again.
  await act(async () => choice("News ticker").click());
  expect(choice("Crop to the graphic").disabled).toBe(true);
  expect(link()).toContain("show=ticker,checkIn&event=");
  await act(async () => choice("All except these").click());
  expect(link()).toContain("hide=ticker,checkIn&event=");
  expect(link()).not.toContain("show=");
});
