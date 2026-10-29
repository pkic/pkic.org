// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { useStickyToolbar } from "../../assets/ts/ui/use-sticky-toolbar";

const host = document.createElement("div");
document.body.append(host);
function Editor() {
  const root = useRef<HTMLDivElement>(null);
  useStickyToolbar(root);
  return <div ref={root} data-editor />;
}
afterEach(async () => {
  await act(() => render(null, host));
  host.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, left: 0, right: 375, width: 375, height }) as DOMRect;

it("tracks the height of pinned semantic headers and clears its geometry on unmount", async () => {
  vi.useFakeTimers();
  const header = document.createElement("header");
  header.style.position = "sticky";
  host.append(header);
  let height = 60;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this === header ? rect(0, height) : rect(200, 2000);
  });
  const mount = document.createElement("div");
  host.append(mount);
  await act(() => render(<Editor />, mount));
  const editor = mount.querySelector<HTMLElement>("[data-editor]")!;
  expect(editor.style.getPropertyValue("--pk-editor-sticky-top")).toBe("60px");
  height = 100;
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await vi.runOnlyPendingTimersAsync();
  });
  expect(editor.style.getPropertyValue("--pk-editor-sticky-top")).toBe("100px");
  await act(() => render(null, mount));
  expect(editor.style.getPropertyValue("--pk-editor-sticky-top")).toBe("");
});

it("measures a nested scrolling surface from its own top instead of adding the outside header twice", async () => {
  const outside = document.createElement("header");
  outside.style.position = "fixed";
  const surface = document.createElement("div");
  surface.style.overflowY = "auto";
  const inside = document.createElement("header");
  inside.style.position = "sticky";
  const mount = document.createElement("div");
  surface.append(inside, mount);
  host.append(outside, surface);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this === outside
      ? rect(0, 60)
      : this === surface
        ? rect(100, 600)
        : this === inside
          ? rect(100, 32)
          : rect(200, 2000);
  });
  await act(() => render(<Editor />, mount));
  expect(mount.querySelector<HTMLElement>("[data-editor]")!.style.getPropertyValue("--pk-editor-sticky-top")).toBe(
    "32px",
  );
  await act(() => render(null, mount));
});
