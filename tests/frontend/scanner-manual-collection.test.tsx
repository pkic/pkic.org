import { badgeCode, mocks, host, mount, scannerDialog } from "./event-scanner-fixture";
import { render } from "preact";
import { EventScanner } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";

it("holds a manually collected attendee in the normal view and advances without starting the camera", async () => {
  const previousHash = window.location.hash;
  try {
    window.location.hash = "#/events/synthetic-event/scanner?scannerPurpose=collection";
    mocks.snapshot = {
      serverNow: "2026-12-01T09:00:00.000Z",
      expiresAt: "2026-12-05T00:00:00.000Z",
      validUntil: Date.parse("2026-12-05T00:00:00.000Z"),
    };
    const lookupName = vi.fn(async () => "Zoë 山田");
    Object.assign(mocks.snapshot, { lookupName });
    await mount(true, ["attendance"]);
    const now = new Date().toISOString();
    const collectorContext = scannerOfflineContextSchema.parse({
      eventId: "33333333-3333-4333-8333-333333333333",
      operatorUserId: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222",
      epochId: mocks.epochId,
      sessionId: "44444444-4444-4444-8444-444444444444",
      slug: "synthetic-event",
      route: "/events/synthetic-event/scanner",
      action: "attendance",
      occurrenceId: null,
      roomId: null,
      publishedRevision: null,
      serverNow: now,
      savedAt: now,
      lastObservedAt: now,
      expiresAt: new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString(),
    });
    await act(() =>
      render(
        <EventScanner
          key="prepared-collector"
          slug="synthetic-event"
          operatorUserId={collectorContext.operatorUserId}
          allowedActions={["attendance"]}
          collectorContext={collectorContext}
        />,
        host,
      ),
    );
    expect(host.querySelector(".pk-fast-scanner")).toBeNull();
    const enterManually = async () => {
      await act(async () => {
        Array.from(host.querySelectorAll("button"))
          .find((button) => button.textContent?.trim() === "Find attendee or badge")!
          .click();
      });
      const dialog = scannerDialog("Enter badge code");
      Object.defineProperty(dialog, "close", { configurable: true, value: () => dialog.removeAttribute("open") });
      const input = dialog.querySelector<HTMLInputElement>('input[name="badgeId"]')!;
      await act(async () => {
        input.value = badgeCode;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        Array.from(dialog.querySelectorAll("button"))
          .find((button) => button.textContent?.trim() === "Record attendance")!
          .click();
      });
    };
    await enterManually();
    await vi.waitFor(() =>
      expect(host.querySelector('[aria-label="Attendee name"]')?.textContent, host.textContent ?? "").toBe("Zoë 山田"),
    );
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(lookupName).toHaveBeenCalledWith(badgeCode);
    expect(host.querySelector(".pk-fast-scanner")).toBeNull();
    const next = () =>
      Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Next attendee")!;
    await vi.waitFor(() => expect(next().disabled).toBe(false));
    await act(async () => next().click());
    expect(host.querySelector('[aria-label="Attendee name"]')).toBeNull();
    expect(host.querySelector(".pk-fast-scanner")).toBeNull();
    expect(mocks.cameraScan).toBeNull();
    await enterManually();
    await vi.waitFor(() => expect(mocks.persist).toHaveBeenCalledTimes(2));
    expect(host.querySelector('[aria-label="Attendee name"]')?.textContent).toBe("Zoë 山田");
  } finally {
    window.location.hash = previousHash;
  }
});
