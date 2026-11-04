import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { LiveChatMessageRow } from "../../assets/ts/live-session/LiveChatMessageRow";
import { liveSnapshot } from "./helpers/live-room-socket";

const confirmAction = vi.hoisted(() => vi.fn());
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction }));

afterEach(() => {
  render(null, document.body);
  vi.resetAllMocks();
});

it("clears a confirmation failure on retry and sends only after confirmation", async () => {
  const send = vi.fn(() => true);
  const message = {
    channel: "attendee" as const,
    id: "40000000-0000-4000-8000-000000000001",
    text: "Hello",
    authorName: "Sam",
    authorPhotoUrl: null,
    mine: true,
    sentAt: "2026-11-04T12:00:00.000Z",
    reactions: {},
    myReactions: [],
    reportedByMe: false,
    moderation: null,
  };
  confirmAction.mockRejectedValueOnce(new Error("Failed"));
  await act(() =>
    render(
      <ul>
        <LiveChatMessageRow
          message={message}
          viewer={liveSnapshot().viewer}
          send={send}
          disabled={false}
          timeZone="UTC"
        />
      </ul>,
      document.body,
    ),
  );
  const chooseDelete = async () => {
    await act(() => document.querySelector<HTMLButtonElement>('button[aria-label^="Actions for message"]')!.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) =>
      node.textContent?.includes("Delete message"),
    );
    await act(async () => {
      item!.click();
      await Promise.resolve();
    });
  };
  await chooseDelete();
  expect(document.body.textContent).toContain("Could not complete the action");
  expect(send).not.toHaveBeenCalled();
  let resolve!: (value: boolean) => void;
  confirmAction.mockReturnValueOnce(
    new Promise<boolean>((done) => {
      resolve = done;
    }),
  );
  await chooseDelete();
  expect(document.body.textContent).not.toContain("Could not complete the action");
  expect(send).not.toHaveBeenCalled();
  await act(() => resolve(true));
  expect(send).toHaveBeenCalledWith({ type: "chat.delete", messageId: message.id });
});
