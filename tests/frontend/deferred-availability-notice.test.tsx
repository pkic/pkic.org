// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { installDeferredAvailabilityNotice } from "../../assets/ts/shared/availability-notice-loader";
import { publishAvailability, serviceAvailability } from "../../assets/ts/shared/availability-state";

it("shows API refusal and recovery once without polling or replaying a request", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  installDeferredAvailabilityNotice();
  expect(document.body.textContent).not.toContain("Maintenance in progress");
  publishAvailability({ mode: "maintenance", message: "Please retry later.", endsAt: null });
  await vi.waitFor(() => expect(document.body.textContent).toContain("Maintenance in progress"));
  expect(document.body.textContent).toContain("Please retry later.");
  publishAvailability({ mode: "emergency", message: "Services paused.", endsAt: null });
  await act(() => undefined);
  expect(document.body.textContent).toContain("Online services paused");
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  publishAvailability({ mode: "normal", message: "Services restored.", endsAt: null });
  await act(() => undefined);
  expect(document.body.textContent).toContain("Online services restored");
  expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
  serviceAvailability.value = null;
  vi.unstubAllGlobals();
});
