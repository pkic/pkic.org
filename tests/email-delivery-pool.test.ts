import { describe, expect, it, vi } from "vitest";
import { runEmailDeliveryPool, type EmailDeliveryOutcome } from "../functions/_lib/email/outbox-delivery-pool";

const admission = (selectionLimit: number) => ({
  selectionLimit,
  maySelect: () => true,
  startMessage: () => true,
  finishMessage: () => undefined,
});
const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("email delivery pool", () => {
  it("excludes rows already taken by a channel from the next selection", async () => {
    const exclusions: string[][] = [];
    const select = async (inFlightIds: readonly string[]) => {
      exclusions.push([...inFlightIds]);
      return exclusions.length === 1 ? rows("a", "b", "c") : [];
    };
    const result = await runEmailDeliveryPool({
      ...admission(3),
      select,
      deliver: async () => "accepted" as const,
    });
    expect(exclusions).toEqual([[], ["a", "b", "c"]]);
    expect(result).toMatchObject({ processed: 3, exhausted: true });
  });

  it("keeps draining after a message outcome was recorded", async () => {
    const outcomes: Record<string, EmailDeliveryOutcome> = { a: "failed", b: "accepted", c: "skipped" };
    const result = await runEmailDeliveryPool({
      ...admission(10),
      select: async () => rows("a", "b", "c"),
      deliver: async (row) => outcomes[row.id]!,
    });
    expect(result).toMatchObject({ processed: 2, failed: 1, exhausted: true });
  });

  it("stops selecting when a message state cannot be recorded, after in-progress sends settle", async () => {
    const fault = new Error("D1 overloaded");
    let releaseHeldSend!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHeldSend = resolve;
    });
    let heldSendSettled = false;
    const select = vi.fn(async () => rows("held", "fault"));
    const deliver = vi.fn(async (row: { id: string }): Promise<EmailDeliveryOutcome> => {
      if (row.id === "fault") throw fault;
      await held;
      heldSendSettled = true;
      return "accepted";
    });

    const running = runEmailDeliveryPool({ ...admission(2), select, deliver });
    const outcome = running.catch((error: unknown) => error);
    await vi.waitFor(() => expect(deliver.mock.calls.length).toBeGreaterThanOrEqual(2));
    releaseHeldSend();

    expect(await outcome).toBe(fault);
    expect(heldSendSettled).toBe(true);
    // A refill may already be in progress when the fault lands; nothing starts after it.
    expect(select.mock.calls.length).toBeLessThan(5);
  });
});
