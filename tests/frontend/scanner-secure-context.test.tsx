// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { EventScanner } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner";
let host: HTMLElement | undefined;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
});
it("refuses scanner startup before device hooks or network activity when native UUID is unavailable", async () => {
  vi.stubGlobal("crypto", {});
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(<EventScanner slug="synthetic-event" operatorUserId="10000000-0000-4000-8000-000000000001" />, host!),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("HTTPS");
  expect(host.textContent).toContain("localhost");
  expect(fetcher).not.toHaveBeenCalled();
  expect(host.querySelector("video")).toBeNull();
});
