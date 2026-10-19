import { personRoleAt } from "../../../../../../../shared/person-display";
import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  liveAddedCreditInputSchema,
  liveSpeakerCandidatesResponseSchema,
  type LiveAddedCreditInput,
  type LiveSpeakerCandidate,
} from "../../../../../../../shared/schemas/live-session-credit";
import { liveCreditAlreadyListed } from "../../../../../../../shared/live-room-credits";
import { SearchPicker } from "../../../../../../components/SearchPicker";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Dialog } from "../../../../../../ui/Dialog";
import { PersonCell } from "../../../../../../ui/PersonCell";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { PersonPreview, personAffiliation } from "../../../../../../site/PersonCard";

const capacityOf = (candidate: LiveSpeakerCandidate) =>
  personRoleAt({ title: candidate.title, organization: candidate.organization });

/** One way a person can appear, as a search result: photo, name, and the identity they act as. */
function CandidateRow({ candidate, listed }: { candidate: LiveSpeakerCandidate; listed: boolean }) {
  const roleAt = personRoleAt(candidate) || "Appears as themselves";
  return (
    <PersonCell
      name={candidate.name}
      avatarSrc={candidate.photoUrl}
      detail={listed ? `${roleAt} · Already in this session` : roleAt}
      size="sm"
    />
  );
}

/**
 * Adds someone to this session's lower thirds: one identity of someone at
 * the event, found by name or organization, whose title and organization
 * come from that identity; or the name of someone without an account. The
 * room keeps them for this session and every operator sees them.
 */
export function LiveAddPersonDialog({
  slug,
  listed,
  onAdd,
  onClose,
}: {
  slug: string;
  /** The keys of everyone already among the session's lower thirds, so search marks them. */
  listed: ReadonlySet<string>;
  onAdd: (person: LiveAddedCreditInput) => boolean;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<LiveSpeakerCandidate | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(liveAddedCreditInputSchema, {
    userId: picked?.userId ?? null,
    identityId: picked?.identityId ?? null,
    name: picked?.name ?? name,
  });

  function add() {
    const checked = form.submit();
    if (!checked.data) return setError(null);
    if (!onAdd(checked.data)) return setError("The room is reconnecting. Try again in a moment.");
    onClose();
  }

  return (
    <Dialog
      open
      title="Add a person"
      description="For this session's lower thirds only. Every operator sees them."
      confirmLabel="Add person"
      onConfirm={add}
      onCancel={onClose}
    >
      <form
        class="pk-stack pk-stack--snug"
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Field
          label="Find someone at the event"
          help="Search by name or organization. Someone with several identities appears once for each."
          {...form.of("identityId")}
        >
          {(control) => (
            <SearchPicker<z.infer<typeof liveSpeakerCandidatesResponseSchema>, LiveSpeakerCandidate>
              picked={picked ? [picked.name, capacityOf(picked)].filter(Boolean).join(" · ") : null}
              onPick={(candidate) => {
                setPicked(candidate);
                setName("");
              }}
              onClear={() => setPicked(null)}
              endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/people/identities`}
              responseSchema={liveSpeakerCandidatesResponseSchema}
              rows={(data) => data.identities}
              rowKey={(candidate) => `${candidate.userId}:${candidate.identityId ?? ""}`}
              renderRow={(candidate) => (
                <CandidateRow candidate={candidate} listed={liveCreditAlreadyListed(listed, candidate)} />
              )}
              rowDisabled={(candidate) => liveCreditAlreadyListed(listed, candidate)}
              decorateOption={(candidate, option) => (
                <PersonPreview
                  person={{
                    name: candidate.name,
                    photoUrl: candidate.photoUrl,
                    affiliation: personAffiliation(candidate.title, candidate.organization),
                    sessionRole: liveCreditAlreadyListed(listed, candidate) ? "Already in this session" : null,
                  }}
                >
                  {option}
                </PersonPreview>
              )}
              rowText={(candidate) => [candidate.name, capacityOf(candidate)].filter(Boolean).join(" · ")}
              noun={["person", "people"]}
              label="Find someone at the event"
              resultsLabel="Matching people"
              placeholder="Name or organization"
              inputProps={control}
              emptyMessage="No one at this event matches. Type their name below instead."
              errorMessage="Could not search the event's people."
            />
          )}
        </Field>
        <Field
          label="Or someone without an account"
          help="Their name only, as it should read on air."
          {...form.of("name")}
        >
          {(control) => (
            <TextInput
              {...control}
              name="name"
              value={name}
              autocomplete="off"
              disabled={picked !== null}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          )}
        </Field>
        {error ? <p class="pk-live-questions__notice">{error}</p> : null}
      </form>
    </Dialog>
  );
}
