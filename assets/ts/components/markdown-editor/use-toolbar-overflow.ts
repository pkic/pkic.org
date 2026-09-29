import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/** Keep every command that fits visible, including part of a formatting group. */
export function useToolbarOverflow(toolbar: RefObject<HTMLDivElement>, commandCount: number): number {
  const widths = useRef<number[]>([]);
  const [visible, setVisible] = useState(commandCount);
  useLayoutEffect(() => {
    const bar = toolbar.current;
    if (!bar) return;
    const fit = () => {
      const style = getComputedStyle(bar);
      const gap = parseFloat(style.columnGap) || 0;
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      bar.querySelectorAll<HTMLElement>("[data-command]").forEach((button) => {
        if (button.offsetWidth) widths.current[Number(button.dataset.command)] = button.offsetWidth;
      });
      if (widths.current.length < commandCount) return;
      const source = bar.querySelector<HTMLElement>("[data-source]");
      const sourceWidth = source?.offsetWidth ?? 0;
      const endStyle = source?.parentElement ? getComputedStyle(source.parentElement) : style;
      const endInset = (parseFloat(endStyle.paddingLeft) || 0) + (parseFloat(endStyle.borderLeftWidth) || 0);
      const endGap = parseFloat(endStyle.columnGap) || 0;
      const extraControls = [...(source?.parentElement?.children ?? [])].filter(
        (element) => element !== source && !element.hasAttribute("data-overflow"),
      );
      const extraWidth = extraControls.reduce((sum, element) => sum + (element as HTMLElement).offsetWidth + endGap, 0);
      const available = bar.clientWidth - padding - sourceWidth - extraWidth - gap - endInset;
      const buttons = [...bar.querySelectorAll<HTMLElement>("[data-command]")];
      const commandWidth = (index: number) => {
        const groupStyle = getComputedStyle(buttons[index].parentElement!);
        const separation =
          buttons[index].dataset.sectionStart === "true"
            ? gap + (parseFloat(groupStyle.paddingLeft) || 0) + (parseFloat(groupStyle.borderLeftWidth) || 0)
            : parseFloat(groupStyle.columnGap) || 0;
        return widths.current[index] + (index === 0 ? 0 : separation);
      };
      const total = buttons.reduce((sum, _, index) => sum + commandWidth(index), 0);
      // Reserve the overflow trigger only when a command actually needs it.
      const overflowWidth = bar.querySelector<HTMLElement>("[data-overflow]")?.offsetWidth || sourceWidth;
      const budget = total <= available ? available : available - overflowWidth - endGap;
      let used = 0;
      let count = 0;
      while (count < commandCount && used + commandWidth(count) <= budget) used += commandWidth(count++);
      setVisible(count);
    };
    fit();
    window.addEventListener("resize", fit);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(bar);
    return () => {
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, [toolbar, commandCount]);
  return visible;
}
