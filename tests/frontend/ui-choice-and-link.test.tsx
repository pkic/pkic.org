// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { ButtonLink } from "../../assets/ts/ui/Button";
import { Checkbox, Radio } from "../../assets/ts/ui/Checkbox";

let container: HTMLDivElement | null = null;
function mount(node: preact.VNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}
afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("choice controls", () => {
  it("wraps the native control in the system's label so the whole line is the target", () => {
    const root = mount(<Checkbox name="active" label="Active" hint="Can sign in" checked onChange={() => {}} />);
    const label = root.querySelector("label.pk-check");
    const input = label?.querySelector<HTMLInputElement>("input.pk-check__input");
    expect(input?.type).toBe("checkbox");
    expect(input?.name).toBe("active");
    expect(input?.checked).toBe(true);
    expect(label?.querySelector(".pk-check__label")?.textContent).toBe("Active");
    expect(label?.querySelector(".pk-check__hint")?.textContent).toBe("Can sign in");
  });

  it("draws a radio the same way, and a switch by its role", () => {
    const root = mount(
      <>
        <Radio name="kind" value="a" label="A" />
        <Checkbox name="on" label="On" role="switch" />
      </>,
    );
    const [radio, sw] = [...root.querySelectorAll<HTMLInputElement>("input")];
    expect(radio.type).toBe("radio");
    expect(sw.getAttribute("role")).toBe("switch");
  });
});

describe("ButtonLink", () => {
  it("is a link that draws like the button beside it", () => {
    const root = mount(
      <ButtonLink href="#/events" variant="primary" size="sm">
        Open
      </ButtonLink>,
    );
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("#/events");
    expect(link?.className).toBe("pk-btn pk-btn--primary pk-btn--sm");
    expect(link?.textContent).toBe("Open");
  });
});
