// @vitest-environment jsdom
/**
 * A controlled checkbox has to be tickable.
 *
 * Preact reconciles a controlled input from its `input` event. A controlled
 * checkbox wired only to `onChange` therefore reverts — Preact re-renders from
 * `input` with the old `checked` before `change` fires — so the box flicks
 * back and the caller's state never moves. To a reader it is a checkbox that
 * refuses to tick, and no amount of clicking helps.
 *
 * It hid because every browser spec that drove one of these drove a *radio*,
 * where a double application is invisible: checking a checked radio leaves it
 * checked. Twenty-seven call sites pass `onChange`, which is why `Choice`
 * absorbs the difference rather than each of them.
 */
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { Checkbox, Radio } from "../../assets/ts/ui/Checkbox";

let host: HTMLElement | null = null;

function mount(node: preact.ComponentChild): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  void act(() => render(node, host!));
  return host;
}

afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
});

function ControlledCheckbox({ onChangeStyle }: { onChangeStyle: boolean }) {
  const [on, setOn] = useState(false);
  const set = (event: Event) => setOn((event.target as HTMLInputElement).checked);
  return (
    <>
      {onChangeStyle ? (
        <Checkbox checked={on} onChange={set} label="Tick me" />
      ) : (
        <Checkbox checked={on} onInput={set} label="Tick me" />
      )}
      <p>{on ? "on" : "off"}</p>
    </>
  );
}

function clickTheBox(container: HTMLElement): void {
  const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  void act(() => {
    input.checked = !input.checked;
    // The event a browser fires first, and the one Preact reconciles from.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("a controlled choice control", () => {
  it("ticks when the caller wired it to onChange", () => {
    const container = mount(<ControlledCheckbox onChangeStyle />);
    expect(container.textContent).toContain("off");
    clickTheBox(container);
    expect(container.textContent).toContain("on");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  });

  it("ticks when the caller wired it to onInput", () => {
    const container = mount(<ControlledCheckbox onChangeStyle={false} />);
    clickTheBox(container);
    expect(container.textContent).toContain("on");
  });

  it("still lets a radio report the choice it was given", () => {
    const chosen: string[] = [];
    const container = mount(
      <>
        <Radio name="pick" value="a" checked onChange={() => chosen.push("a")} label="A" />
        <Radio name="pick" value="b" onChange={() => chosen.push("b")} label="B" />
      </>,
    );
    const b = container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1];
    void act(() => {
      b.checked = true;
      b.dispatchEvent(new Event("input", { bubbles: true }));
      b.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(chosen).toEqual(["b"]);
  });
});
