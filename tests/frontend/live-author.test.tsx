import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveAuthorDetails } from "../../assets/shared/schemas/live-session-author";
import { liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
import { LiveAuthorName, LiveAuthorProvider } from "../../assets/ts/live-session/LiveAuthor";

const HANDLE = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const DETAILS: LiveAuthorDetails = {
  handle: HANDLE,
  name: "Paul van Brouwershaven",
  photoUrl: null,
  affiliation: { title: "Chief Architect", organization: { name: "Digitorus" } },
  roles: ["speaker", "chair", "member"],
  profilePath: "/people/paul-van-brouwershaven/",
};

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
});

function mount(authors: Record<string, LiveAuthorDetails | null> = {}, handle: string | null = HANDLE) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const send = vi.fn((_message: unknown) => true);
  const draw = (next: Record<string, LiveAuthorDetails | null>) =>
    render(
      <LiveAuthorProvider authors={next} send={send}>
        <LiveAuthorName
          name="Paul van Brouwershaven"
          handle={handle}
          affiliation={DETAILS.affiliation}
          roles={DETAILS.roles}
        />
      </LiveAuthorProvider>,
      host,
    );
  void act(() => draw(authors));
  return { host, send, draw: (next: Record<string, LiveAuthorDetails | null>) => act(() => draw(next)) };
}

describe("live author names", () => {
  it("shows the capacity in muted type, without brackets, and the two highest role marks", () => {
    const { host } = mount();
    expect(host.querySelector(".pk-live-author__capacity")?.textContent).toBe("Digitorus");
    expect(host.textContent).not.toContain("(");
    const marks = [...host.querySelectorAll(".pk-live-role")];
    expect(marks.map((mark) => [mark.getAttribute("data-role"), mark.textContent])).toEqual([
      ["speaker", "Speaker"],
      ["chair", "Chair"],
    ]);
    // The mark's name is real text, so it is announced when only the icon shows.
    expect(marks[0].querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(marks[0].getAttribute("title")).toBe("Speaker");
  });

  it("asks the room for the card on focus and shows it with every role and the profile link", async () => {
    const { host, send, draw } = mount();
    const name = host.querySelector<HTMLButtonElement>("button.pk-live-author__name")!;
    await act(async () => name.focus());
    expect(send.mock.calls.map(([message]) => liveRoomClientMessageSchema.parse(message))).toEqual([
      { type: "author.lookup", handle: HANDLE },
    ]);
    await draw({ [HANDLE]: DETAILS });
    const card = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(card.getAttribute("aria-label")).toBe("About Paul van Brouwershaven");
    expect(name.getAttribute("aria-expanded")).toBe("true");
    expect(name.getAttribute("aria-controls")).toBe(card.id);
    expect(card.querySelector("a")?.getAttribute("href")).toBe("/people/paul-van-brouwershaven/");
    // The same person card as the studio's: a portrait large enough to recognize them.
    expect(card.querySelector(".pk-agenda-speaker-directory__card .pk-avatar--xl")).not.toBeNull();
    expect(card.textContent).toContain("Chief Architect");
    expect(card.textContent).toContain("Digitorus");
    expect([...card.querySelectorAll(".pk-live-role")].map((mark) => mark.textContent)).toEqual([
      "Speaker",
      "Chair",
      "PKI Consortium member",
    ]);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    // A second focus does not ask again.
    await act(async () => name.blur());
    await act(async () => name.focus());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("opens and closes the card with a tap", async () => {
    const { host } = mount({ [HANDLE]: DETAILS });
    const name = host.querySelector<HTMLButtonElement>("button.pk-live-author__name")!;
    const tap = () =>
      act(async () => {
        name.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
        name.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      });
    await tap();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await tap();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps an author without a handle, such as an anonymous one, plain text", () => {
    const { host, send } = mount({}, null);
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("strong.pk-live-author__name")?.textContent).toBe("Paul van Brouwershaven");
    expect(send).not.toHaveBeenCalled();
  });
});
