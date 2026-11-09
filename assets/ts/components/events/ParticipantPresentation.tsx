import { useAsyncSubmission } from "../../hooks/useAsyncSubmission";
import { useState } from "preact/hooks";
import {
  type SpeakerSelfServiceReadResponse,
  speakerPresentationUploadResponseSchema,
} from "../../../shared/schemas/speaker-self-service";
import { presentationUploadRequest, DEFAULT_PRESENTATION_TERMS } from "../../../shared/presentation-upload";
import { proposalSpeakerAccessPath } from "../../../shared/proposal-access-paths";
import { requestJson } from "../../shared/api-client";
import { refusalSentence } from "../../shared/form/validation-map";
import { formatDateTime } from "../../shared/ui";
import { showHeadshotDisclaimer } from "../../shared/headshot/upload";
import { Alert } from "../../ui/Alert";
import { DownloadAction } from "../../ui/DownloadAction";
import { Field } from "../../ui/Field";
import { FileInput } from "../../ui/FileInput";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";

export function ParticipantPresentation({
  data,
  reload,
}: {
  data: SpeakerSelfServiceReadResponse;
  reload: () => Promise<void>;
}) {
  const { submitting: busy, error, begin, finish, setError } = useAsyncSubmission();
  const [message, setMessage] = useState("");
  const [uploadAttempt, setUploadAttempt] = useState(0);
  const path = (...segments: string[]) =>
    proposalSpeakerAccessPath("/api/v1", { resourceId: data.proposal.id }, ...segments);
  const deadlinePassed = Boolean(
    data.proposal.presentationDeadline && Date.parse(data.proposal.presentationDeadline) < Date.now(),
  );
  async function upload(file: File) {
    setError(null);
    setMessage("");
    try {
      const accepted = await showHeadshotDisclaimer({
        title: "Before you upload your presentation",
        texts: data.presentationTerms.length
          ? data.presentationTerms.map((term) => term.displayText ?? term.termKey)
          : DEFAULT_PRESENTATION_TERMS,
        confirmText: "Upload presentation",
      });
      if (!accepted) return;
      begin();
      await requestJson(path("presentation"), speakerPresentationUploadResponseSchema, {
        method: "PUT",
        ...presentationUploadRequest(file),
      });
      setMessage("Presentation uploaded.");
      await reload();
    } catch (cause) {
      setError(refusalSentence(cause));
    } finally {
      setUploadAttempt((attempt) => attempt + 1);
      finish();
    }
  }
  if (data.proposal.status !== "accepted" || data.speaker.status !== "confirmed")
    return (
      <Alert>Presentations are available after the proposal is accepted and your participation is confirmed.</Alert>
    );
  return (
    <div class="pk-stack">
      {error && <Alert tone="danger">{error}</Alert>}
      {message && <Alert tone="ok">{message}</Alert>}
      <Panel aria-label="Presentation">
        <PanelHeader title="Presentation" />
        <PanelBody>
          <div class="pk-stack">
            {data.proposal.presentationDeadline && (
              <p>Upload deadline: {formatDateTime(data.proposal.presentationDeadline)}</p>
            )}
            {(data.proposal.presentationUploaded || data.proposal.presentationUploader) && (
              <div class="pk-cluster">
                {data.proposal.presentationUploaded && (
                  <DownloadAction label="Download current presentation" href={path("presentation")} />
                )}
                {data.proposal.presentationUploader && (
                  <span>
                    Uploaded by{" "}
                    {[data.proposal.presentationUploader.firstName, data.proposal.presentationUploader.lastName]
                      .filter(Boolean)
                      .join(" ")}{" "}
                    on {formatDateTime(data.proposal.presentationUploader.uploadedAt)}.
                  </span>
                )}
              </div>
            )}
            {deadlinePassed && <Alert>The presentation upload deadline has passed.</Alert>}
            <Field label="Presentation file">
              {(control) => (
                <FileInput
                  {...control}
                  accept=".pdf,.ppt,.pptx,.pptm,.odp"
                  disabled={busy || deadlinePassed}
                  resetKey={uploadAttempt}
                  onFileChange={(file) => {
                    if (file) void upload(file);
                  }}
                />
              )}
            </Field>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
