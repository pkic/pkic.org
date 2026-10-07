import { readConsentValues } from "../../shared/widgets/consents";
import { useCallback, useRef, useState } from "preact/hooks";
import {
  speakerSelfProfilePatchSchema,
  speakerParticipationPatchSchema,
} from "../../../shared/schemas/proposal-management";
import {
  speakerProfileUpdateResponseSchema,
  speakerParticipationResponseSchema,
  speakerPresentationUploadResponseSchema,
  type SpeakerSelfServiceReadResponse,
} from "../../../shared/schemas/speaker-self-service";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { headshotUploadResponseSchema } from "../../../shared/schemas/registration";
import { isProposalSpeakerRosterEditableStatus } from "../../../shared/schemas/proposal-status";
import { proposalSpeakerAccessPath } from "../../../shared/proposal-access-paths";
import { presentationUploadRequest, DEFAULT_PRESENTATION_TERMS } from "../../../shared/presentation-upload";
import type { RequiredTerm } from "../../../shared/schemas/forms";
import { useContractForm } from "../../hooks/useContractForm";
import { patchJson, requestJson } from "../../shared/api-client";
import { formatDateTime } from "../../shared/ui";
import { AdminHeadshotManager } from "../../shared/headshot/AdminHeadshotManager";
import { showHeadshotDisclaimer } from "../../shared/headshot/upload";
import { ProfileLinksInput } from "../ProfileLinksInput";
import { MarkdownEditor } from "../markdown-editor/MarkdownInput";
import { ConsentCard } from "../ConsentCard";
import { Badge } from "../Badge";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { SpeakerParticipationIdentity } from "../SpeakerParticipationIdentity";
import type { ProposalEntrySelection } from "../useProposalEntryIdentity";
import {
  eventProposalProofIdentityPatchSchema,
  eventProposalProofIdentityPatchResponseSchema,
} from "../../../shared/schemas/event-proposal-proof";

export function ParticipantSpeaker({
  data,
  eventSlug,
  terms,
  reload,
}: {
  data: SpeakerSelfServiceReadResponse;
  eventSlug: string;
  terms: RequiredTerm[];
  reload: () => Promise<void>;
}) {
  const access = { resourceId: data.proposal.id };
  const path = (...segments: string[]) => proposalSpeakerAccessPath("/api/v1", access, ...segments);
  const [draft, setDraft] = useState({
    biography: data.profile.biography ?? "",
    links: data.profile.links,
  });
  const [consents, setConsents] = useState<Array<{ termKey: string; version: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const [entry, setEntry] = useState<ProposalEntrySelection | null>(null);
  const [identityChanged, setIdentityChanged] = useState(data.profile.actingIdentitySelection === "unrecorded");
  const onEditing = useCallback(() => setIdentityChanged(true), []);
  const onIdentityChange = useCallback((value: ProposalEntrySelection | null) => {
    setEntry(value);
  }, []);
  const profileRoot = useRef<HTMLFormElement>(null);
  const acceptedConsents = () =>
    data.speaker.status === "invited" ? consents : readConsentValues(profileRoot.current!);
  const termsAccepted = terms.every(
    (term) =>
      !term.required || consents.some((value) => value.termKey === term.termKey && value.version === term.version),
  );
  const form = useContractForm(speakerSelfProfilePatchSchema, draft);
  const participation = useContractForm(speakerParticipationPatchSchema, { status: "confirmed", consents });
  const editable = data.speaker.status !== "declined" && isProposalSpeakerRosterEditableStatus(data.proposal.status);
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setMessage(message);
      await reload();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  const photoEndpoint = path("headshot");
  const deadlinePassed = Boolean(
    data.proposal.presentationDeadline && Date.parse(data.proposal.presentationDeadline) < Date.now(),
  );
  return (
    <div class="pk-stack">
      {error && <Alert tone="danger">{error}</Alert>}
      {message && <Alert tone="ok">{message}</Alert>}
      <Panel key={`${data.proposal.id}:participation`}>
        <PanelHeader title="Speaker participation" />
        <PanelBody>
          <div class="pk-stack">
            <div class="pk-cluster">
              <Badge status={data.speaker.status} />
            </div>
            {!editable && (
              <Alert>Participation changes are unavailable because you declined or the proposal is closed.</Alert>
            )}
            {editable && data.speaker.status !== "confirmed" && (
              <form
                noValidate
                {...participation.handlers}
                onChange={(event) => {
                  participation.handlers.onChange?.(event);
                  const element = event.currentTarget;
                  setConsents(readConsentValues(element));
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const checked = participation.submit();
                  if (!checked.data) {
                    setError(checked.message);
                    return;
                  }
                  void perform(
                    () => patchJson(path("participation"), checked.data, speakerParticipationResponseSchema),
                    "Participation confirmed.",
                  );
                }}
              >
                <fieldset class="pk-fieldset pk-stack" disabled={busy}>
                  {terms.map((term) => (
                    <ConsentCard term={term} key={term.termKey} />
                  ))}
                  <Button type="submit" loading={busy}>
                    Confirm participation
                  </Button>
                </fieldset>
              </form>
            )}
            {editable && (
              <Button
                variant="danger-quiet"
                loading={busy}
                onClick={() => {
                  if (confirm("Decline your participation in this proposal?"))
                    void perform(
                      () =>
                        patchJson(path("participation"), { status: "declined" }, speakerParticipationResponseSchema),
                      "Participation declined.",
                    );
                }}
              >
                Decline participation
              </Button>
            )}
          </div>
        </PanelBody>
      </Panel>
      <Panel key={`${data.proposal.id}:profile`}>
        <PanelHeader title="Speaker profile" />
        <PanelBody>
          <div class="pk-stack">
            <p>{data.profile.email}</p>
            {(editable || data.profile.headshotUrl) && (
              <AdminHeadshotManager
                readOnly={!editable}
                initialUrl={data.profile.headshotUrl}
                alt="Speaker photo"
                uploadHeadshot={async (file) => {
                  const body = new FormData();
                  body.append("file", file, "headshot.jpg");
                  return requestJson(photoEndpoint, headshotUploadResponseSchema, { method: "PUT", body });
                }}
                deleteHeadshot={async () => {
                  await requestJson(photoEndpoint, successResponseSchema, { method: "DELETE" });
                }}
                onUploaded={reload}
                onDeleted={reload}
                onError={setError}
              />
            )}
            <form
              ref={profileRoot}
              noValidate
              {...form.handlers}
              onSubmit={(event) => {
                event.preventDefault();
                if (identityChanged && !entry) {
                  setError("Confirm your identity and email before saving your profile.");
                  return;
                }
                const checked = form.submit();
                if (!checked.data) {
                  setError(checked.message);
                  return;
                }
                void perform(async () => {
                  await patchJson(
                    path("profile"),
                    speakerSelfProfilePatchSchema.parse({
                      ...checked.data,
                      ...(identityChanged && entry
                        ? {
                            actingIdentityId: entry.actingIdentityId,
                            continuationToken: entry.continuationToken,
                            unaffiliatedAttestation: entry.unaffiliatedAttestation,
                            consents: acceptedConsents(),
                            ...entry.missingDetails,
                          }
                        : {}),
                    }),
                    speakerProfileUpdateResponseSchema,
                  );
                  const fragment = new URL(location.hash.slice(1), location.origin);
                  if (fragment.searchParams.has("verify")) {
                    fragment.searchParams.delete("verify");
                    history.replaceState(
                      {},
                      "",
                      `${location.pathname}${location.search}#${fragment.pathname}${fragment.search}`,
                    );
                  }
                  setIdentityChanged(false);
                }, "Speaker profile saved.");
              }}
            >
              <fieldset class="pk-fieldset pk-stack" disabled={busy || !editable}>
                <SpeakerParticipationIdentity
                  key={data.profile.actingIdentitySelectedAt ?? "unrecorded"}
                  data={data}
                  eventSlug={eventSlug}
                  speakerProposalId={data.proposal.id}
                  terms={terms}
                  termsAccepted={termsAccepted}
                  termsReady
                  consents={acceptedConsents}
                  onChange={onIdentityChange}
                  onEditing={onEditing}
                  savePersonalDetails={async (names) => {
                    const saved = await patchJson(
                      path("profile"),
                      speakerSelfProfilePatchSchema.parse(names),
                      speakerProfileUpdateResponseSchema,
                    );
                    return { ...saved.profile, bio: saved.profile.biography };
                  }}
                  saveRepresentation={(identityId, role) =>
                    patchJson(
                      `/api/v1/events/${encodeURIComponent(eventSlug)}/proposals/proof/identities/${encodeURIComponent(identityId)}`,
                      eventProposalProofIdentityPatchSchema.parse({ ...role, speakerProposalId: data.proposal.id }),
                      eventProposalProofIdentityPatchResponseSchema,
                    )
                  }
                />
                <Field label="Biography" {...form.of("biography")}>
                  {(control) => (
                    <MarkdownEditor
                      disabled={busy || !editable}
                      variant="compact"
                      {...control}
                      name="biography"
                      label="Biography"
                      initialValue={draft.biography}
                      onChange={(biography) => setDraft({ ...draft, biography })}
                    />
                  )}
                </Field>
                <ProfileLinksInput
                  value={draft.links}
                  onChange={(links) => setDraft({ ...draft, links })}
                  fieldName="links"
                />
                {editable && (
                  <Button type="submit" loading={busy}>
                    Save speaker profile
                  </Button>
                )}
              </fieldset>
            </form>
          </div>
        </PanelBody>
      </Panel>
      {data.proposal.status === "accepted" && data.speaker.status === "confirmed" && (
        <Panel key={`${data.proposal.id}:presentation`}>
          <PanelHeader title="Presentation" />
          <PanelBody>
            <div class="pk-stack">
              {data.proposal.presentationDeadline && (
                <p>Upload deadline: {formatDateTime(data.proposal.presentationDeadline)}</p>
              )}
              {data.proposal.presentationUploaded && <a href={path("presentation")}>Download current presentation</a>}
              {data.proposal.presentationUploader && (
                <p>
                  Uploaded by{" "}
                  {[data.proposal.presentationUploader.firstName, data.proposal.presentationUploader.lastName]
                    .filter(Boolean)
                    .join(" ")}{" "}
                  on {formatDateTime(data.proposal.presentationUploader.uploadedAt)}.
                </p>
              )}
              {deadlinePassed && <Alert>The presentation upload deadline has passed.</Alert>}
              <Field label="Presentation file">
                {(control) => (
                  <TextInput
                    {...control}
                    ref={upload}
                    type="file"
                    accept=".pdf,.ppt,.pptx,.pptm,.odp"
                    disabled={busy || deadlinePassed}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) return;
                      void (async () => {
                        const accepted = await showHeadshotDisclaimer({
                          title: "Before you upload your presentation",
                          texts: data.presentationTerms.length
                            ? data.presentationTerms.map((term) => term.displayText ?? term.termKey)
                            : DEFAULT_PRESENTATION_TERMS,
                          confirmText: "Upload presentation",
                        });
                        if (accepted)
                          await perform(
                            () =>
                              requestJson(path("presentation"), speakerPresentationUploadResponseSchema, {
                                method: "PUT",
                                ...presentationUploadRequest(file),
                              }),
                            "Presentation uploaded.",
                          );
                      })();
                    }}
                  />
                )}
              </Field>
            </div>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
