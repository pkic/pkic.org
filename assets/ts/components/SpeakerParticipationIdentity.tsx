import { useLayoutEffect, useState } from "preact/hooks";
import type { z } from "zod";
import type { eventProposalProofIdentityPatchResponseSchema } from "../../shared/schemas/event-proposal-proof";
import type { RequiredTerm } from "../../shared/schemas/forms";
import type { speakerSelfServiceReadResponseSchema } from "../../shared/schemas/speaker-self-service";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { ConsentList } from "./ConsentCard";
import { EventProposalIdentityStep } from "./EventProposalIdentityStep";
import { ParticipationRepresentation, type RepresentationRolePatch } from "./ParticipationRepresentation";
import type { PersonalNamePatch } from "./ParticipationPersonalDetails";
import { ParticipationPersonalDetails } from "./ParticipationPersonalDetails";
import type { ParticipationPerson, ProposalEntrySelection } from "./useProposalEntryIdentity";

type SpeakerData = z.infer<typeof speakerSelfServiceReadResponseSchema>;

/** Existing invitation details stay readable; changes cross the same verified affiliation boundary as proposals. */
export function SpeakerParticipationIdentity({
  data,
  eventSlug,
  token,
  terms,
  termsAccepted,
  termsReady,
  consents,
  onChange,
  onEditing,
  savePersonalDetails,
  saveRepresentation,
}: {
  data: SpeakerData;
  eventSlug: string;
  token: string;
  terms: RequiredTerm[];
  termsAccepted: boolean;
  termsReady: boolean;
  consents: () => { termKey: string; version: string }[];
  onChange: (selection: ProposalEntrySelection | null) => void;
  onEditing: () => void;
  saveRepresentation?: (
    identityId: string,
    role: RepresentationRolePatch,
  ) => Promise<z.infer<typeof eventProposalProofIdentityPatchResponseSchema>>;
  savePersonalDetails?: (names: PersonalNamePatch) => Promise<ParticipationPerson>;
}) {
  const [representation, setRepresentation] = useState(data.currentRepresentation);
  const saveRole =
    representation?.actingIdentityId && saveRepresentation
      ? async (role: RepresentationRolePatch) => {
          const identityId = representation.actingIdentityId!;
          const saved = await saveRepresentation(identityId, role);
          setRepresentation((current) =>
            current?.actingIdentityId === saved.identityId ? { ...current, jobTitle: saved.jobTitle } : current,
          );
        }
      : undefined;
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
  const [changing, setChanging] = useState(
    data.profile.actingIdentitySelection === "unrecorded" || new URLSearchParams(location.hash.slice(1)).has("verify"),
  );
  const [localTermsAccepted, setLocalTermsAccepted] = useState(terms.every((term) => !term.required));
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
                  <ConsentList terms={terms} />
                </div>
              )}
            </Field>
          )}
          {accepted ? (
            <EventProposalIdentityStep
              enabled
              eventSlug={eventSlug}
              speakerManagementToken={token}
              expectedSpeakerUserId={data.speaker.userId}
              consents={consents}
              onChange={onChange}
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
            save={saveRole}
            savedMessage="Your current representation is updated. Your recorded appearance for this proposal stays unchanged."
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
