import { useState } from "preact/hooks";
import { formatNumber } from "../../../../../../../shared/format-number";
import { liveChatEraseResponseSchema } from "../../../../../../../shared/schemas/event-live-chat-archive";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { friendlyErrorMessage } from "../../../../../../components/ErrorAlert";
import { deleteJson, getBlob } from "../../../../../../shared/api-client";
import { downloadFile } from "../../../../../../shared/download-file";
import { Button } from "../../../../../../ui/Button";
import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { toast } from "../../../../ui";

function chats(count: number) {
  return `${formatNumber(count)} ${count === 1 ? "chat" : "chats"}`;
}

/**
 * Organizers download every room's kept attendee chat in one file,
 * then erase it. Erasing is its own confirmed step, so a download that failed
 * never costs the messages, and a failed download stays on this page.
 */
export function LiveChatArchive({ slug }: { slug: string }) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/agenda/chat`;
  const [erasing, setErasing] = useState(false);

  async function download() {
    try {
      downloadFile(await getBlob(`${endpoint}/exports`), "text/csv", `${slug}-live-chat.csv`);
    } catch (error) {
      toast(friendlyErrorMessage((error as Error).message), "error");
    }
  }

  async function erase() {
    const confirmed = await confirmAction({
      title: "Erase every room's chat?",
      body: "Download the chat first if you want to keep a copy.",
      consequences: [
        "The attendee and operator chat of every room is removed once its day is over.",
        "A chat that is still open today keeps its messages.",
        "The message counts in Session popularity stay.",
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
        result.openChats > 0
          ? `Erased ${chats(result.erasedChats)}. ${chats(result.openChats)} still open kept ${result.openChats === 1 ? "its" : "their"} messages.`
          : `Erased ${chats(result.erasedChats)}.`,
        "success",
      );
    } catch (error) {
      toast(friendlyErrorMessage((error as Error).message), "error");
    } finally {
      setErasing(false);
    }
  }

  return (
    <Panel aria-label="Attendee chat">
      <PanelHeader title="Attendee chat">
        <DownloadAction label="Download chat (CSV)" onDownload={download} />
        <Button variant="danger-quiet" loading={erasing} onClick={() => void erase()}>
          Erase chat…
        </Button>
      </PanelHeader>
      <PanelBody>
        <p class="pk-small pk-muted">
          Download the chat every room still keeps in one file, then erase it. The message counts in Session popularity
          stay.
        </p>
      </PanelBody>
    </Panel>
  );
}
