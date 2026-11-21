import { personRoleAt } from "../../../../../../../shared/person-display";
import { useState } from "preact/hooks";
import type { z } from "zod";
import type { ComponentChildren } from "preact";
import {
  liveAddedCreditInputSchema,
  liveSpeakerCandidatesResponseSchema,
  liveTypedCreditInputSchema,
  type LiveAddedCreditInput,
  type LiveCredit,
  type LiveSpeakerCandidate,
  type LiveTypedCreditInput,
} from "../../../../../../../shared/schemas/live-session-credit";
import { liveCreditAlreadyListed } from "../../../../../../../shared/live-room-credits";
import { SearchPicker } from "../../../../../../components/SearchPicker";
import { useContractForm, type ContractForm } from "../../../../../../hooks/useContractForm";
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

const RECONNECTING = "The room is reconnecting. Try again in a moment.";

/** What an operator typed for someone without an account, as the room takes it: an empty second line is none. */
const typedPerson = (name: string, titleLine: string) => ({ name, titleLine: titleLine.trim() || null });

/**
 * The two lines of someone without an account, as they read on air: the
 * name, and under it a second line that no identity supplies for them.
 */
function TypedPersonFields({
  form,
  nameLabel,
  nameHelp,
  name,
  titleLine,
  disabled = false,
  onName,
  onTitleLine,
}: {
  form: Pick<ContractForm<unknown>, "of">;
  nameLabel: string;
  nameHelp: string;
  name: string;
  titleLine: string;
  /** True while a person from the event is picked: their identity supplies both lines. */
  disabled?: boolean;
  onName: (name: string) => void;
  onTitleLine: (titleLine: string) => void;
}) {
  return (
    <>
      <Field label={nameLabel} help={nameHelp} {...form.of("name")}>
        {(control) => (
          <TextInput
            {...control}
            name="name"
            value={name}
            autocomplete="off"
            disabled={disabled}
            onInput={(event) => onName(event.currentTarget.value)}
          />
        )}
      </Field>
      <Field
        label="Second line"
        help="Optional. Reads under their name on air, such as a title and organization."
        {...form.of("titleLine")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="titleLine"
            value={titleLine}
            autocomplete="off"
            disabled={disabled}
            onInput={(event) => onTitleLine(event.currentTarget.value)}
          />
        )}
      </Field>
    </>
  );
}

/** The dialog both ways of naming a person share: its form, and the room's answer when it could not be sent. */
function PersonDialog({
  title,
  description,
  confirmLabel,
  form,
  error,
  onSave,
  onClose,
  children,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  form: Pick<ContractForm<unknown>, "handlers">;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
  children: ComponentChildren;
}) {
  return (
    <Dialog
      open
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      onConfirm={onSave}
      onCancel={onClose}
    >
      <form
        class="pk-stack pk-stack--snug"
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {children}
        {error ? <p class="pk-live-questions__notice">{error}</p> : null}
      </form>
    </Dialog>
  );
}

/**
 * Adds someone to this session's lower thirds: one identity of someone at
 * the event, found by name or organization, whose title and organization
 * come from that identity; or someone without an account, by the name and
 * second line an operator types. The room keeps them for this session and
 * every operator sees them.
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
  const [titleLine, setTitleLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(
    liveAddedCreditInputSchema,
    picked
      ? { userId: picked.userId, identityId: picked.identityId, name: picked.name, titleLine: null }
      : { userId: null, identityId: null, ...typedPerson(name, titleLine) },
  );

  function add() {
    const checked = form.submit();
    if (!checked.data) return setError(null);
    if (!onAdd(checked.data)) return setError(RECONNECTING);
    onClose();
  }

  return (
    <PersonDialog
      title="Add a person"
      description="For this session's lower thirds only. Every operator sees them."
      confirmLabel="Add person"
      form={form}
      error={error}
      onSave={add}
      onClose={onClose}
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
              setTitleLine("");
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
      <TypedPersonFields
        form={form}
        nameLabel="Or someone without an account"
        nameHelp="Their name, as it should read on air."
        name={name}
        titleLine={titleLine}
        disabled={picked !== null}
        onName={setName}
        onTitleLine={setTitleLine}
      />
    </PersonDialog>
  );
}

/**
 * Edits someone added without an account: the name and second line an
 * operator typed for them. Saving changes them for every operator and on
 * every output that shows their lower third.
 */
export function LiveEditPersonDialog({
  credit,
  onSave,
  onClose,
}: {
  credit: Pick<LiveCredit, "name" | "titleLine">;
  onSave: (person: LiveTypedCreditInput) => boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(credit.name);
  const [titleLine, setTitleLine] = useState(credit.titleLine ?? "");
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(liveTypedCreditInputSchema, typedPerson(name, titleLine));

  function save() {
    const checked = form.submit();
    if (!checked.data) return setError(null);
    if (!onSave(checked.data)) return setError(RECONNECTING);
    onClose();
  }

  return (
    <PersonDialog
      title="Edit person"
      description="Changes their lower third for every operator, and on air if it is showing."
      confirmLabel="Save changes"
      form={form}
      error={error}
      onSave={save}
      onClose={onClose}
    >
      <TypedPersonFields
        form={form}
        nameLabel="Name"
        nameHelp="As it should read on air."
        name={name}
        titleLine={titleLine}
        onName={setName}
        onTitleLine={setTitleLine}
      />
    </PersonDialog>
  );
}
