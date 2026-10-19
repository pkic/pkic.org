// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ListDetail } from "../../assets/ts/ui/ListDetail";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
});

const items = [
  { id: "a", label: "Welcome", detail: "Always" },
  { id: "b", label: "Next", detail: "Last five minutes", attention: "Unsupported placeholder" },
  { id: "c", label: "Sponsors" },
];

it("lists items as rows beside the selected one's fields, and moves and selects from labeled buttons", () => {
  const onSelect = vi.fn();
  const onMove = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  hosts.push(host);
  void act(() =>
    render(
      <ListDetail items={items} selectedId="b" onSelect={onSelect} onMove={onMove} listLabel="Ticker messages">
        <p>Fields of Next</p>
      </ListDetail>,
      host,
    ),
  );
  const rows = [...host.querySelectorAll('[aria-label="Ticker messages"] > li')];
  expect(rows.map((row) => row.querySelector(".pk-list-detail__label")?.textContent)).toEqual([
    "Welcome",
    "Next",
    "Sponsors",
  ]);
  expect(rows[1]!.querySelector("[aria-current='true']")).not.toBeNull();
  expect(rows[1]!.textContent).toContain("Unsupported placeholder");
  expect(host.querySelector(".pk-list-detail__detail-pane")?.textContent).toBe("Fields of Next");
  // The first cannot move up and the last cannot move down.
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Move Welcome up"]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Move Sponsors down"]')!.disabled).toBe(true);
  void act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Move Next down"]')!.click());
  expect(onMove).toHaveBeenCalledWith("b", 1);
  void act(() => rows[2]!.querySelector<HTMLButtonElement>(".pk-list-detail__select")!.click());
  expect(onSelect).toHaveBeenCalledWith("c");
});
