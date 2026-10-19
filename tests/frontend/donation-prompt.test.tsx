// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { DonationPrompt } from "../../assets/ts/shared/donation/DonationPrompt";

let container: HTMLDivElement;
afterEach(async () => {
  if (container) {
    await act(() => render(null, container));
    container.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the existing donation form in place, prefilled, without a payment request", async () => {
  const request = vi.fn(() => {
    throw new Error("Opening a donation must not call checkout");
  });
  vi.stubGlobal("fetch", request);
  container = document.createElement("div");
  document.body.append(container);
  const address = location.href;
  await act(() =>
    render(
      <DonationPrompt options={{ name: "Local Attendee", email: "attendee@example.test", source: "event:demo" }} />,
      container,
    ),
  );
  const opener = [...container.querySelectorAll("button")].find((b) => b.textContent === "Donate now")!;
  await act(() => opener.click());
  await act(async () => {
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("[data-donation-name-input]")?.value).toBe("Local Attendee"),
    );
  });
  const dialog = document.querySelector("dialog")!;
  expect(dialog).not.toBeNull();
  expect(dialog.querySelector<HTMLInputElement>("[data-donation-name-input]")?.value).toBe("Local Attendee");
  expect(dialog.querySelector<HTMLInputElement>("[data-donation-email-input]")?.value).toBe("attendee@example.test");
  expect(dialog.querySelectorAll("[data-preset-amount]").length).toBeGreaterThan(0);
  expect(request).not.toHaveBeenCalled();
  expect(location.href).toBe(address);
  await act(() => dialog.querySelector<HTMLButtonElement>('[aria-label="Close donation"]')!.click());
  expect(document.querySelector("dialog")).toBeNull();
});
