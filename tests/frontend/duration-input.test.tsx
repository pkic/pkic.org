// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { DurationInput } from "../../assets/ts/ui/DurationInput";
import { Field } from "../../assets/ts/ui/Field";

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
});

function type(input: HTMLInputElement, value: string) {
  void act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("sets a length as hours, minutes and seconds under one legend, and is null when empty or out of range", () => {
  const changed = vi.fn();
  host = document.body.appendChild(document.createElement("div"));
  void act(() =>
    render(
      <Field label="Length" group>
        {(control) => <DurationInput control={control} name="length" value={3725} onChange={changed} />}
      </Field>,
      host!,
    ),
  );
  const boxes = [...host.querySelectorAll<HTMLInputElement>("input")];
  expect(host.querySelector("legend")?.textContent).toContain("Length");
  expect(boxes.map((box) => [box.getAttribute("aria-label"), box.value])).toEqual([
    ["Hours", "1"],
    ["Minutes", "02"],
    ["Seconds", "05"],
  ]);
  type(boxes[1]!, "30");
  expect(changed).toHaveBeenLastCalledWith(3600 + 30 * 60 + 5);
  type(boxes[1]!, "75");
  expect(changed).toHaveBeenLastCalledWith(null);
  for (const box of boxes) type(box, "");
  expect(changed).toHaveBeenLastCalledWith(null);
  type(boxes[2]!, "45");
  expect(changed).toHaveBeenLastCalledWith(45);
});
