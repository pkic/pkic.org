import { SPEAKER_PARTICIPATION_COPY } from "../../../shared/proposal-speaker-acceptance";
import { readConsentValues } from "../../shared/widgets/consents";
import { useCallback, useRef, useState } from "preact/hooks";
import {
  speakerSelfProfilePatchSchema,
  speakerParticipationPatchSchema,
} from "../../../shared/schemas/proposal-management";
import {
  speakerProfileUpdateResponseSchema,
  speakerParticipationResponseSchema,
  type SpeakerSelfServiceReadResponse,
} from "../../../shared/schemas/speaker-self-service";
import { headshotUploadResponseSchema } from "../../../shared/schemas/registration";
import { isProposalSpeakerRosterEditableStatus } from "../../../shared/schemas/proposal-status";
import { proposalSpeakerAccessPath } from "../../../shared/proposal-access-paths";
import type { RequiredTerm } from "../../../shared/schemas/forms";
import { useContractForm } from "../../hooks/useContractForm";
import { patchJson } from "../../shared/api-client";
import { HeadshotTile } from "../../shared/headshot/HeadshotTile";
import { headshotFormEndpoint } from "../../shared/headshot/endpoints";
import { IdentityProfileForm } from "../identities/IdentityProfileForm";
import { ConsentCard, ConsentList } from "../ConsentCard";
import { Badge, PlainStatus } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { DescriptionList } from "../../ui/DescriptionList";
import { LinkList } from "../../ui/LinkList";
import { normalizeProfileLinks } from "../../shared/widgets/profile-links";
import { Markdown } from "../../ui/Markdown";
import { Menu } from "../../ui/Menu";
import { SpeakerParticipationIdentity } from "../SpeakerParticipationIdentity";
import { newAffiliationDetails, prepareProposalEntry, type ProposalEntrySelection } from "../useProposalEntryIdentity";
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
  const [consents, setConsents] = useState(data.acceptedConsents);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [entry, setEntry] = useState<ProposalEntrySelection | null>(null);
  const [identityChanged, setIdentityChanged] = useState(data.profile.actingIdentitySelection === "unrecorded");
  const onEditing = useCallback(() => setIdentityChanged(true), []);
  const onIdentityChange = useCallback((value: ProposalEntrySelection | null) => {
    setEntry(value);
  }, []);
  const profileRoot = useRef<HTMLFormElement>(null);
  const acceptedConsents = () =>
    // Before the profile form mounts, the saved agreements stand.
    data.speaker.status === "invited"
      ? consents
      : profileRoot.current
        ? readConsentValues(profileRoot.current)
        : data.acceptedConsents;
  const termsAccepted = terms.every(
    (term) =>
      !term.required || consents.some((value) => value.termKey === term.termKey && value.version === term.version),
  );
  // The identity choice is the only proposal-side profile write; the identity's own profile is edited on the identity.
  const form = useContractForm(speakerSelfProfilePatchSchema, {});
  const participation = useContractForm(speakerParticipationPatchSchema, { status: "confirmed", consents });
  const editable = data.speaker.status !== "declined" && isProposalSpeakerRosterEditableStatus(data.proposal.status);
  async function decline() {
    const confirmed = await confirmAction({
      title: `Decline your participation in ${data.proposal.title}?`,
      consequences: ["You are no longer listed as a speaker on this proposal"],
      confirmLabel: "Decline participation",
      cancelLabel: "Keep participating",
      tone: "danger",
    });
    if (!confirmed) return;
    await perform(
      () => patchJson(path("participation"), { status: "declined" }, speakerParticipationResponseSchema),
      "Participation declined.",
    );
  }
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      if (message) setMessage(message);
      await reload();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  const photoEndpoint = path("headshot");
  const representation = data.currentRepresentation;
  const identityPath = (identityId: string) =>
    `/api/v1/events/${encodeURIComponent(eventSlug)}/proposals/proof/identities/${encodeURIComponent(identityId)}`;
  const profileLinks = normalizeProfileLinks(data.profile.links);
  const speakerName = [data.profile.firstName, data.profile.lastName].filter(Boolean).join(" ") || data.profile.email;
  return (
    <div class="pk-stack">
      {error && <Alert tone="danger">{error}</Alert>}
      {message && <Alert tone="ok">{message}</Alert>}
      <Panel key={`${data.proposal.id}:participation`}>
        <PanelHeader
          title="Speaker participation"
          menu={
            editable ? (
              <Menu
                label="Participation actions"
                align="end"
                items={[
                  {
                    id: "decline",
                    label: "Decline participation…",
                    danger: true,
                    disabled: busy,
                    onSelect: () => void decline(),
                  },
                ]}
              />
            ) : undefined
          }
        />
        <PanelBody>
          <div class="pk-stack">
            <p>{SPEAKER_PARTICIPATION_COPY.explanation}</p>
            {data.speaker.awaitingReview && <Alert tone="warn">{SPEAKER_PARTICIPATION_COPY.pending}</Alert>}
            <div class="pk-cluster">
              {data.speaker.status === "confirmed" || data.speaker.status === "invited" ? (
                <PlainStatus status={data.speaker.status} />
              ) : (
                <Badge status={data.speaker.status} />
              )}
            </div>
            {!editable && (
              <Alert>Participation changes are unavailable because you declined or the proposal is closed.</Alert>
            )}
            {(data.speaker.status === "confirmed" || data.speaker.awaitingReview || !editable) &&
              !identityChanged &&
              terms.length > 0 && (
                <fieldset class="pk-fieldset pk-stack" disabled>
                  <legend>Speaker terms and conditions</legend>
                  <ConsentList terms={terms} recorded={data.acceptedConsents} />
                </fieldset>
              )}
            {editable && data.speaker.status !== "confirmed" && !data.speaker.awaitingReview && (
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
                    setError(checked.formMessage ?? "");
                    return;
                  }
                  void perform(async () => {
                    const response = await patchJson(
                      path("participation"),
                      checked.data,
                      speakerParticipationResponseSchema,
                    );
                    setMessage(response.status === "pending" ? "" : SPEAKER_PARTICIPATION_COPY.confirmed);
                  }, "");
                }}
              >
                <fieldset class="pk-fieldset pk-stack" disabled={busy}>
                  {terms.map((term) => (
                    <ConsentCard
                      term={term}
                      key={term.termKey}
                      recorded={consents.some(
                        (value) => value.termKey === term.termKey && value.version === term.version,
                      )}
                    />
                  ))}
                  {!data.currentRepresentation && (
                    <p class="pk-small pk-muted">
                      Accept the terms, then choose and save your speaker identity before confirming.
                    </p>
                  )}
                  <Button type="submit" loading={busy} disabled={!termsAccepted || !data.currentRepresentation}>
                    {SPEAKER_PARTICIPATION_COPY.confirm}
                  </Button>
                </fieldset>
              </form>
            )}
          </div>
        </PanelBody>
      </Panel>
      <Panel key={`${data.proposal.id}:profile`} aria-label="Speaker profile">
        <PanelHeader title="Speaker profile">
          {editable && representation && !editing && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setMessage("");
                setError("");
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
        </PanelHeader>
        <PanelBody>
          <div class="pk-stack">
            <p>{data.profile.email}</p>
            {editable && !data.profile.headshotUrl && (
              <p>Please upload a headshot so attendees can recognize you and we can promote your session.</p>
            )}
            {(editable || data.profile.headshotUrl) && (
              <HeadshotTile
                name={speakerName}
                canChange={editable}
                imageUrl={data.profile.headshotUrl}
                consent="own"
                self
                endpoint={headshotFormEndpoint(photoEndpoint, headshotUploadResponseSchema)}
                onChanged={() => reload()}
                notify={(text, type) => {
                  setError(type === "error" ? text : "");
                  setMessage(type === "success" ? text : "");
                }}
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
                  setError(checked.formMessage ?? "");
                  return;
                }
                void perform(async () => {
                  const submittedEntry = identityChanged && entry ? await prepareProposalEntry(entry) : null;
                  await patchJson(
                    path("profile"),
                    speakerSelfProfilePatchSchema.parse({
                      ...checked.data,
                      ...(submittedEntry
                        ? {
                            actingIdentityId: submittedEntry.actingIdentityId,
                            continuationToken: submittedEntry.continuationToken,
                            unaffiliatedAttestation: submittedEntry.unaffiliatedAttestation,
                            independentCapacity: submittedEntry.independentCapacity,
                            ...(submittedEntry.continuationToken ? { consents: acceptedConsents() } : {}),
                            ...newAffiliationDetails(submittedEntry),
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
                }, "Speaker identity saved.");
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
                  onCancelEditing={() => {
                    setEntry(null);
                    setIdentityChanged(false);
                  }}
                  onTermsRecorded={setConsents}
                  savePersonalDetails={async (names) => {
                    const saved = await patchJson(
                      path("profile"),
                      speakerSelfProfilePatchSchema.parse(names),
                      speakerProfileUpdateResponseSchema,
                    );
                    return { ...saved.profile, bio: saved.profile.biography };
                  }}
                />
                {!editing && (
                  <DescriptionList
                    items={[
                      {
                        term: "Biography",
                        value: data.profile.biography ? <Markdown markdown={data.profile.biography} /> : undefined,
                      },
                      {
                        term: "Profile links",
                        value: profileLinks.length ? (
                          <LinkList links={profileLinks} ownerName={speakerName} />
                        ) : undefined,
                      },
                    ]}
                  />
                )}
                {editable && identityChanged && (
                  <div class="pk-cluster">
                    <Button type="submit" variant="primary" loading={busy}>
                      Save speaker identity
                    </Button>
                  </div>
                )}
              </fieldset>
            </form>
            {editable && editing && representation && (
              <IdentityProfileForm
                identity={representation}
                editor="owner"
                purpose="speaker"
                save={(body) =>
                  patchJson(
                    identityPath(representation.identityId),
                    eventProposalProofIdentityPatchSchema.parse({ ...body, speakerProposalId: data.proposal.id }),
                    eventProposalProofIdentityPatchResponseSchema,
                  )
                }
                onSaved={() => {
                  setEditing(false);
                  setMessage("Profile updated.");
                  void reload();
                }}
                cancel={
                  <Button type="button" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                }
              />
            )}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
