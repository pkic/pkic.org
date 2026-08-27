import { useState } from "preact/hooks";
import { headshotUrlResponseSchema } from "../../../shared/schemas/registration";
import { AdminHeadshotManager, ADMIN_HEADSHOT_DISCLAIMER } from "../../shared/headshot/AdminHeadshotManager";
import { requestJson } from "../../shared/api-client";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import type { ProposalSpeaker } from "../../../shared/schemas/proposal-speakers";
import { type ToastType } from "../../shared/ui";

export function ProposalSpeakerHeadshotManager({
  speaker,
  proposalId,
  name,
  canEdit,
  assetPath,
  onSaved,
  notify,
}: {
  speaker: ProposalSpeaker;
  proposalId: string;
  name: string;
  canEdit: boolean;
  assetPath: (proposalId: string, userId: string, asset: "headshot" | "gravatar") => string;
  onSaved: (userId: string, patch: Partial<ProposalSpeaker>) => void;
  notify?: (message: string, type: ToastType) => void;
}) {
  const [status, setStatus] = useState("");
  const path = (asset: "headshot" | "gravatar") => assetPath(proposalId, speaker.userId, asset);

  async function upload(file: Blob) {
    const data = await requestJson(path("headshot"), headshotUrlResponseSchema, {
      method: "PUT",
      headers: { "Content-Type": file.type || "image/jpeg" },
      body: file,
    });
    return { headshotUrl: data.headshotUrl };
  }

  async function fetchGravatar() {
    setStatus("Looking up Gravatar...");
    try {
      const data = await requestJson(path("gravatar"), headshotUrlResponseSchema, { method: "POST" });
      onSaved(speaker.userId, { headshotUrl: data.headshotUrl, hasHeadshot: Boolean(data.headshotUrl) });
      setStatus("Gravatar imported");
      notify?.("Gravatar imported successfully", "success");
    } catch (caught) {
      const message = (caught as Error).message;
      setStatus(`Error: ${message}`);
      notify?.(message, "error");
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
        requestJson(path("headshot"), successResponseSchema, { method: "DELETE" }).then(() => undefined)
      }
      onFetchGravatar={fetchGravatar}
      disclaimerTexts={ADMIN_HEADSHOT_DISCLAIMER}
      onUploaded={(headshotUrl) => {
        onSaved(speaker.userId, { headshotUrl: headshotUrl ?? null, hasHeadshot: Boolean(headshotUrl) });
        notify?.("Headshot uploaded", "success");
      }}
      onDeleted={() => {
        onSaved(speaker.userId, { headshotUrl: null, hasHeadshot: false });
        notify?.("Headshot removed", "success");
      }}
      onError={(message) => notify?.(message, "error")}
      confirmDeleteMessage="Remove this user's headshot?"
    />
  );
}
