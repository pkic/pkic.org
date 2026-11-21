import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { eventScanRequestSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { badgeCode, host, mocks, mount } from "./event-scanner-fixture";

it("offers admission exception review only to permitted staff and saves the reviewed badge", async () => {
  await mount(true, ["attendance", "exception"], undefined, undefined, true);
  mocks.persist.mockImplementation(async (input) => ({
    scan: eventScanRequestSchema.parse(input),
    local: { outcome: "warning", reason: "missing_registration", message: "Registration required" },
  }));
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Start scanning")!
      .click();
  });
  await act(async () => mocks.hardwareScan!(badgeCode));
  const scanner = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Continuous badge scanner"]')!;
  await vi.waitFor(() => expect(scanner.textContent).toContain("Review admission exception"));
  await act(async () => scanner.querySelector<HTMLButtonElement>('[aria-label="Operator controls"]')!.click());
  const drawer = scanner.querySelector<HTMLElement>('[role="dialog"][aria-label="Scanner operator controls"]')!;
  const review = [...drawer.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Review admission exception",
  );
  expect(review).toBeDefined();
  await act(async () => review!.click());
  await act(async () => {
    drawer.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(mocks.persist).toHaveBeenCalledTimes(2));
  const saved = eventScanRequestSchema.parse(mocks.persist.mock.calls[1]![0]);
  expect(saved).toMatchObject({ action: "exception", badgeId: badgeCode, exceptionReason: "organizer_approval" });
});

it("keeps admission exception review unavailable without the exception permission", async () => {
  await mount(true, ["attendance", "exception"]);
  mocks.persist.mockImplementation(async (input) => ({
    scan: eventScanRequestSchema.parse(input),
    local: { outcome: "warning", reason: "missing_registration", message: "Registration required" },
  }));
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Start scanning")!
      .click();
  });
  await act(async () => mocks.hardwareScan!(badgeCode));
  const scanner = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Continuous badge scanner"]')!;
  await vi.waitFor(() => expect(scanner.textContent).toContain("Verification pending"));
  await act(async () => scanner.querySelector<HTMLButtonElement>('[aria-label="Operator controls"]')!.click());
  expect(scanner.textContent).not.toContain("Review admission exception");
});
