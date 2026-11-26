import { render } from "preact";
import { act } from "preact/test-utils";
import { useRef } from "preact/hooks";
import { afterEach, expect, it, vi } from "vitest";
import { usePopupPlacement } from "../../assets/ts/ui/popup-placement";

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, left: 20, right: 320, width: 300, height }) as DOMRect;

const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reattaches the popup when the mobile keyboard closes and the visible viewport scrolls", async () => {
  const viewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, width: 375, height: 400 });
  vi.stubGlobal("visualViewport", viewport);
  let anchorTop = 300;
  const positions: string[] = [];
  const afterPlace = () => positions.push(host.querySelector<HTMLElement>('[data-testid="popup"]')!.style.top);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.dataset.anchor ? rect(anchorTop, 40) : rect(0, 120);
  });
  function Picker() {
    const anchorRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    usePopupPlacement({ open: true, anchorRef, popupRef, afterPlace });
    return (
      <>
        <div ref={anchorRef} data-anchor="true" />
        <div ref={popupRef} data-testid="popup" />
      </>
    );
  }
  await act(() => render(<Picker />, host));
  const popup = host.querySelector<HTMLElement>('[data-testid="popup"]')!;
  expect(popup.style.top).toBe("176px");
  viewport.height = 812;
  anchorTop = 400;
  viewport.dispatchEvent(new Event("resize"));
  expect(popup.style.top).toBe("444px");
  anchorTop = 200;
  viewport.dispatchEvent(new Event("scroll"));
  expect(popup.style.top).toBe("244px");
  expect(positions).toEqual(expect.arrayContaining(["176px", "444px", "244px"]));
  expect(positions.at(-1)).toBe("244px");
  await act(() => render(null, host));
  viewport.dispatchEvent(new Event("resize"));
});

it("keeps a field's matches scrolled where the reader left them and drops the cap once the keyboard closes", async () => {
  const viewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, width: 375, height: 400 });
  vi.stubGlobal("visualViewport", viewport);
  let scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.anchor) return rect(200, 40);
    // Laid out without its cap the list no longer overflows, so the browser resets its offset.
    if (!this.style.maxHeight) scrollTop = 0;
    return rect(0, 300);
  });
  function Picker() {
    const anchorRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    usePopupPlacement({ open: true, anchorRef, popupRef, keepAnchorVisible: true });
    return (
      <>
        <div ref={anchorRef} data-anchor="true" />
        <div ref={popupRef} data-testid="popup" />
      </>
    );
  }
  await act(() => render(<Picker />, host));
  const popup = host.querySelector<HTMLElement>('[data-testid="popup"]')!;
  expect(popup.style.maxHeight).toBe("188px");
  expect(popup.style.top).toBe("8px");
  Object.defineProperty(popup, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => (scrollTop = value),
  });
  scrollTop = 120;
  popup.dispatchEvent(new Event("scroll"));
  expect(scrollTop).toBe(120);
  expect(popup.style.maxHeight).toBe("188px");
  viewport.height = 812;
  viewport.dispatchEvent(new Event("resize"));
  expect(popup.style.maxHeight).toBe("");
  expect(popup.style.top).toBe("244px");
});
