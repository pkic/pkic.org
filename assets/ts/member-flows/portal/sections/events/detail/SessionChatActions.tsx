import { useState } from "preact/hooks";
import { liveChatEraseResponseSchema } from "../../../../../../shared/schemas/event-live-chat-archive";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { friendlyErrorMessage } from "../../../../../components/ErrorAlert";
import { deleteJson } from "../../../../../shared/api-client";
import { Button } from "../../../../../ui/Button";
import { DownloadAction } from "../../../../../ui/DownloadAction";
import { toast } from "../../../ui";

function sessions(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

/**
 * Moderators download every session's kept attendee chat in one file, then
 * erase it. Erasing is its own confirmed step, so a download that failed
 * never costs the messages. The counts in the report stay.
 */
export function SessionChatActions({ slug }: { slug: string }) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/agenda/chat`;
  const [erasing, setErasing] = useState(false);

  async function erase() {
    const confirmed = await confirmAction({
      title: "Erase the chat of every session?",
      body: "Download the chat first if you want to keep a copy.",
      consequences: [
        "The attendee and operator chat of every session that has ended is removed.",
        "Sessions that are still live keep their chat.",
        "The message counts in this report stay.",
        "This cannot be undone.",
      ],
      confirmLabel: "Erase chat",
      tone: "danger",
    });
    if (!confirmed) return;
    setErasing(true);
    try {
      const result = await deleteJson(endpoint, liveChatEraseResponseSchema);
      toast(
        result.openSessions > 0
          ? `Chat erased for ${sessions(result.erasedSessions)}. ${sessions(result.openSessions)} still live kept theirs.`
          : `Chat erased for ${sessions(result.erasedSessions)}.`,
        "success",
      );
    } catch (error) {
      toast(friendlyErrorMessage((error as Error).message), "error");
    } finally {
      setErasing(false);
    }
  }

  return (
    <>
      <DownloadAction label="Download chat (CSV)" href={`${endpoint}/exports`} />
      <Button variant="danger-quiet" loading={erasing} onClick={() => void erase()}>
        Erase chat…
      </Button>
    </>
  );
}
