import { useCallback, useLayoutEffect, useState } from "preact/hooks";
import type { z } from "zod";
import type { RequiredTerm } from "../../shared/schemas/forms";
import type { ConsentItem } from "../../shared/schemas/registration";
import type { speakerSelfServiceReadResponseSchema } from "../../shared/schemas/speaker-self-service";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { ConsentList } from "./ConsentCard";
import { EventProposalIdentityStep } from "./EventProposalIdentityStep";
import { ParticipationRepresentation } from "./ParticipationRepresentation";
import type { PersonalNamePatch } from "./ParticipationPersonalDetails";
import { ParticipationPersonalDetails } from "./ParticipationPersonalDetails";
import type { ParticipationPerson, ProposalEntrySelection, VerifiedProposalEntry } from "./useProposalEntryIdentity";

type SpeakerData = z.infer<typeof speakerSelfServiceReadResponseSchema>;

/** Existing invitation details stay readable; changes cross the same verified affiliation boundary as proposals. */
export function SpeakerParticipationIdentity({
  data,
  eventSlug,
  token,
  speakerProposalId,
  terms,
  termsAccepted,
  termsReady,
  consents,
  onChange,
  onEditing,
  onTermsRecorded,
  savePersonalDetails,
  initialProof,
}: {
  data: SpeakerData;
  initialProof?: VerifiedProposalEntry;
  eventSlug: string;
  token?: string;
  speakerProposalId?: string;
  terms: RequiredTerm[];
  termsAccepted: boolean;
  termsReady: boolean;
  consents: () => { termKey: string; version: string }[];
  onChange: (selection: ProposalEntrySelection | null) => void;
  onEditing: () => void;
  /** The terms a returning email confirmation recorded: the caller draws them as agreed instead of asking again. */
  onTermsRecorded?: (consents: ConsentItem[]) => void;
  savePersonalDetails?: (names: PersonalNamePatch) => Promise<ParticipationPerson>;
}) {
  // Shown as it is now; its profile is edited on the identity itself, beside this view.
  const representation = data.currentRepresentation;
  const [personal, setPersonal] = useState<ParticipationPerson>({ ...data.profile, bio: data.profile.biography });
  const saveNames = savePersonalDetails
    ? async (names: PersonalNamePatch) => {
        const saved = await savePersonalDetails(names);
        setPersonal(saved);
        return saved;
      }
    : undefined;
  const personalDetails = (
    <ParticipationPersonalDetails
      person={personal}
      save={
        saveNames
          ? async (names) => {
              await saveNames(names);
            }
          : undefined
      }
    />
  );
  const [adding, setAdding] = useState(false);
  const invited = data.speaker.status === "invited";
  // Opened from an email confirmation: the terms it was sent under come back with it, so it is read at once.
  const [returning] = useState(
    () =>
      Boolean(initialProof) ||
      new URLSearchParams(location.hash.slice(1)).has("verify") ||
      new URL(location.hash.slice(1), location.origin).searchParams.has("verify"),
  );
  const [changing, setChanging] = useState(data.profile.actingIdentitySelection === "unrecorded" || returning);
  const [localTermsAccepted, setLocalTermsAccepted] = useState(terms.every((term) => !term.required));
  const [recorded, setRecorded] = useState<ConsentItem[]>();
  const recordTerms = useCallback(
    (consents: ConsentItem[]) => {
      setRecorded(consents);
      setLocalTermsAccepted(true);
      onTermsRecorded?.(consents);
    },
    [onTermsRecorded],
  );
  useLayoutEffect(() => {
    if (changing) onEditing();
  }, [changing, onEditing]);
  const accepted = termsReady && (invited ? termsAccepted : localTermsAccepted);
  return (
    <div class="pk-stack pk-stack--loose">
      {changing ? (
        <>
          {!invited && (
            <Field group label="Speaker terms and conditions" errorSlot="consents">
              {() => (
                <div
                  onInput={() => {
                    const selected = consents();
                    setLocalTermsAccepted(
                      terms.every(
                        (term) =>
                          !term.required ||
                          selected.some((value) => value.termKey === term.termKey && value.version === term.version),
                      ),
                    );
                  }}
                >
                  <ConsentList terms={terms} recorded={recorded} />
                </div>
              )}
            </Field>
          )}
          {accepted || (termsReady && returning) ? (
            <EventProposalIdentityStep
              enabled
              initialProof={initialProof}
              eventSlug={eventSlug}
              speakerManagementToken={token}
              speakerProposalId={speakerProposalId}
              expectedSpeakerUserId={data.speaker.userId}
              consents={consents}
              onChange={onChange}
              onTermsRecorded={recordTerms}
              onSavePersonalDetails={saveNames}
              personalDetails={personalDetails}
              startWithEmailProof={adding}
            />
          ) : (
            <p class="pk-muted">Please accept the speaker terms before confirming your identity.</p>
          )}
        </>
      ) : (
        <>
          {personalDetails}
          <ParticipationRepresentation
            person={representation ? { ...personal, ...representation, bio: representation.biography } : personal}
            available={Boolean(representation)}
          >
            <div class="pk-cluster">
              <Button type="button" variant="secondary" onClick={() => setChanging(true)}>
                Choose another representation
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setAdding(true);
                  setChanging(true);
                }}
              >
                Add representation
              </Button>
            </div>
          </ParticipationRepresentation>
        </>
      )}
    </div>
  );
}
