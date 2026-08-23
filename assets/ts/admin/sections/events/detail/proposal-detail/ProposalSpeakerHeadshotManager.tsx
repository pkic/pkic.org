import { useState } from "preact/hooks";
import { headshotUploadResponseSchema } from "../../../../../../shared/schemas/registration";
import { AdminHeadshotManager, ADMIN_HEADSHOT_DISCLAIMER } from "../../../../../shared/headshot/AdminHeadshotManager";
import { api, apiCommand } from "../../../../api";
import type { ProposalSpeaker } from "../../../../types";
import { toast } from "../../../../ui";

export function adminProposalSpeakerAssetPath(
  proposalId: string,
  userId: string,
  asset: "headshot" | "gravatar",
): string {
  return `/api/v1/admin/proposals/${encodeURIComponent(proposalId)}/speakers/${encodeURIComponent(userId)}/${asset}`;
}

export function ProposalSpeakerHeadshotManager({
  speaker,
  proposalId,
  name,
  canEdit,
  onSaved,
}: {
  speaker: ProposalSpeaker;
  proposalId: string;
  name: string;
  canEdit: boolean;
  onSaved: (userId: string, patch: Partial<ProposalSpeaker>) => void;
}) {
  const [status, setStatus] = useState("");

  async function upload(file: Blob) {
    const data = await api(
      adminProposalSpeakerAssetPath(proposalId, speaker.userId, "headshot"),
      headshotUploadResponseSchema,
      {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      },
    );
    return { headshotUrl: data.headshotUrl };
  }

  async function fetchGravatar() {
    setStatus("Looking up Gravatar...");
    try {
      const data = await api(
        adminProposalSpeakerAssetPath(proposalId, speaker.userId, "gravatar"),
        headshotUploadResponseSchema,
        { method: "POST" },
      );
      onSaved(speaker.userId, {
        headshotUrl: data.headshotUrl,
        hasHeadshot: Boolean(data.headshotUrl),
      });
      setStatus("Gravatar imported");
      toast("Gravatar imported successfully", "success");
    } catch (caught) {
      const message = (caught as Error).message;
      setStatus(`Error: ${message}`);
      toast(message, "error");
    }
  }

  return (
    <AdminHeadshotManager
      initialUrl={speaker.headshotUrl ?? null}
      alt={name}
      emptyLabel="User"
      statusText={status}
      readOnly={!canEdit}
      uploadHeadshot={upload}
      deleteHeadshot={() =>
        apiCommand(adminProposalSpeakerAssetPath(proposalId, speaker.userId, "headshot"), { method: "DELETE" }).then(
          () => undefined,
        )
      }
      onFetchGravatar={fetchGravatar}
      disclaimerTexts={ADMIN_HEADSHOT_DISCLAIMER}
      onUploaded={(headshotUrl) => {
        onSaved(speaker.userId, { headshotUrl: headshotUrl ?? null, hasHeadshot: Boolean(headshotUrl) });
        toast("Headshot uploaded", "success");
      }}
      onDeleted={() => {
        onSaved(speaker.userId, { headshotUrl: null, hasHeadshot: false });
        toast("Headshot removed", "success");
      }}
      onError={(message) => toast(message, "error")}
      confirmDeleteMessage="Remove this user's headshot?"
    />
  );
}
