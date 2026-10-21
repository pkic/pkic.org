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
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.dataset.anchor ? rect(anchorTop, 40) : rect(0, 120);
  });
  function Picker() {
    const anchorRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    usePopupPlacement({ open: true, anchorRef, popupRef });
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
  await act(() => render(null, host));
  viewport.dispatchEvent(new Event("resize"));
});
