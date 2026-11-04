// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { Tooltip } from "../../assets/ts/ui/Tooltip";
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
});
it("shows structured help on focus and tap, and dismisses on Escape and outside press", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <Tooltip
        label="In person, three days"
        content={
          <>
            <strong>In person</strong>
            <span>2 confirmed · 1 waitlisted</span>
          </>
        }
      >
        <span>3</span>
      </Tooltip>,
      host!,
    ),
  );
  const trigger = host.querySelector("button")!;
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(() => trigger.focus());
  const tooltip = document.querySelector('[role="tooltip"]')!;
  expect(tooltip.textContent).toContain("2 confirmed · 1 waitlisted");
  expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
  expect(trigger.hasAttribute("title")).toBe(false);
  await act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(() => trigger.click());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(() => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
