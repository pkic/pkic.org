// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { usePersonCard } from "../../assets/ts/site/PersonCard";
const host = document.createElement("div");
afterEach(() => {
  render(null, host);
  host.remove();
});
function PersonToggle() {
  const card = usePersonCard<HTMLButtonElement>({ person: { name: "Synthetic Person" } });
  return (
    <>
      <button ref={card.anchorRef} {...card.hoverProps} {...card.toggleProps}>
        Person
      </button>
      {card.card}
    </>
  );
}
async function mount() {
  document.body.append(host);
  await act(async () => render(<PersonToggle />, host));
  return host.querySelector("button")!;
}
async function touchDown(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(
      Object.assign(new Event("pointerdown", { bubbles: true }), { pointerType: "touch", pointerId: 1 }),
    );
  });
}
async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
  });
}
async function keyboardFocus(element: HTMLElement) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    element.focus();
  });
}
it("opens on the first tap, not on the focus the tap brings, and closes on the second tap", async () => {
  const button = await mount();
  await touchDown(button);
  await act(async () => button.focus());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click(button);
  expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("About Synthetic Person");
  await touchDown(button);
  await click(button);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it.each(["pointercancel", "pointerup"])(
  "keeps keyboard focus working after a touch ends with %s and no click",
  async (type) => {
    const button = await mount();
    await touchDown(button);
    await act(async () => {
      document.dispatchEvent(Object.assign(new Event(type), { pointerId: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await keyboardFocus(button);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  },
);

function PersonLink() {
  const card = usePersonCard<HTMLAnchorElement>({ person: { name: "Synthetic Person" } });
  return (
    <>
      <a ref={card.anchorRef} href="#/users/synthetic" {...card.hoverProps}>
        Synthetic Person
      </a>
      {card.card}
    </>
  );
}

it("lets a tap on a linked name follow the link, and still previews on keyboard focus", async () => {
  document.body.append(host);
  await act(async () => render(<PersonLink />, host));
  const link = host.querySelector("a")!;
  await act(async () => {
    link.dispatchEvent(Object.assign(new Event("pointerdown", { bubbles: true }), { pointerType: "touch" }));
    link.focus();
  });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => link.blur());
  await keyboardFocus(link);
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});
