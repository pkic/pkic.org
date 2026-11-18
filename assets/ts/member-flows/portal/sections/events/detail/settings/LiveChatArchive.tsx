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

function sessions(count: number) {
  return `${formatNumber(count)} ${count === 1 ? "session" : "sessions"}`;
}

/**
 * Organizers download every session's kept attendee chat in one file,
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
      title: "Erase the chat of every session?",
      body: "Download the chat first if you want to keep a copy.",
      consequences: [
        "The attendee and operator chat of every session that has ended is removed.",
        "Sessions that are still live keep their chat.",
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
    <Panel aria-label="Attendee chat">
      <PanelHeader title="Attendee chat">
        <DownloadAction label="Download chat (CSV)" onDownload={download} />
        <Button variant="danger-quiet" loading={erasing} onClick={() => void erase()}>
          Erase chat…
        </Button>
      </PanelHeader>
      <PanelBody>
        <p class="pk-small pk-muted">
          Download the chat every session still keeps in one file, then erase it. The message counts in Session
          popularity stay.
        </p>
      </PanelBody>
    </Panel>
  );
}
