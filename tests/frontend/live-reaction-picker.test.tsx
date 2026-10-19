// @vitest-environment jsdom
/** The reaction picker: one horizontal toolbar of emoji toggles with the keyboard contract of a toolbar. */

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactionPicker } from "../../assets/ts/live-session/ReactionPicker";

const REACTIONS = [
  { id: "a", label: "Thumbs up", emoji: "👍" },
  { id: "b", label: "Love", emoji: "❤️" },
  { id: "c", label: "Laugh", emoji: "😂" },
];

const hosts: HTMLElement[] = [];

async function mount(onReact = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  await act(async () => {
    render(
      <ReactionPicker label="React" reactions={REACTIONS} pressed={["b"]} onReact={onReact}>
        +
      </ReactionPicker>,
      host,
    );
  });
  const trigger = host.querySelector<HTMLButtonElement>("button")!;
  await act(async () => trigger.click());
  return { host, trigger, onReact };
}

const toolbar = () => document.querySelector<HTMLElement>('[role="toolbar"]');
const press = (target: Element, key: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

describe("ReactionPicker", () => {
  it("opens one horizontal toolbar with a named, pressed-aware button per reaction", async () => {
    const { trigger } = await mount();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const buttons = [...toolbar()!.querySelectorAll("button")];
    expect(toolbar()!.getAttribute("aria-orientation")).toBe("horizontal");
    expect(buttons.map((button) => [button.getAttribute("aria-label"), button.title])).toEqual(
      REACTIONS.map((reaction) => [reaction.label, reaction.label]),
    );
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(toolbar()!.querySelector('[role="menu"], [role^="menuitem"]')).toBeNull();
  });

  it("moves between the emoji with the arrow keys and sends the toggled reaction", async () => {
    const { onReact } = await mount();
    const buttons = [...toolbar()!.querySelectorAll("button")];
    expect(document.activeElement).toBe(buttons[0]);
    await press(buttons[0], "ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    await press(buttons[1], "End");
    expect(document.activeElement).toBe(buttons[2]);
    await press(buttons[2], "ArrowRight");
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => buttons[1].click());
    expect(onReact).toHaveBeenCalledWith("b", false);
    expect(toolbar()).toBeNull();
  });

  it("closes on Escape with focus back on the trigger, and on a click outside", async () => {
    const { trigger } = await mount();
    await press(toolbar()!.querySelector("button")!, "Escape");
    expect(toolbar()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    expect(toolbar()).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(toolbar()).toBeNull();
  });
});
