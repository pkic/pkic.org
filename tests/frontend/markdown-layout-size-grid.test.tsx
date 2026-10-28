// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { LayoutSizeGrid } from "../../assets/ts/components/markdown-editor/LayoutSizeGrid";

it("moves focus through sizing cells and selects the focused dimensions", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const select = vi.fn();
  try {
    await act(() => render(<LayoutSizeGrid columns={8} rows={6} label="Table size" onSelect={select} />, root));
    const cells = root.querySelectorAll<HTMLButtonElement>('[role="gridcell"]');
    await act(() => cells[0]!.focus());
    for (const key of ["ArrowRight", "ArrowRight", "ArrowDown"])
      await act(() => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    expect(document.activeElement).toBe(cells[10]);
    expect(cells[10]!.tabIndex).toBe(0);
    await act(() => cells[10]!.click());
    expect(select).toHaveBeenCalledWith(3, 2);
    await act(() => {
      cells[10]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(cells[47]);
  } finally {
    await act(() => render(null, root));
    root.remove();
  }
});
