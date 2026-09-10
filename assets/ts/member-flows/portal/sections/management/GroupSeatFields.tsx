import { useState } from "preact/hooks";
import type { FieldPresentation } from "../../../../hooks/useContractForm";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";

export interface GroupSeatDraft {
  joinedOn: string;
  leftOn: string;
}

export function useGroupSeatDraft(initial: GroupSeatDraft): {
  draft: GroupSeatDraft;
  onDraft: (patch: Partial<GroupSeatDraft>) => void;
} {
  const [draft, setDraft] = useState(initial);
  return { draft, onDraft: (patch) => setDraft((current) => ({ ...current, ...patch })) };
}

/** Service dates belong to the seat; titles and authority belong to Leadership. */
export function GroupSeatFields({
  draft,
  onDraft,
  field,
  disabled,
}: {
  draft: GroupSeatDraft;
  onDraft: (patch: Partial<GroupSeatDraft>) => void;
  field: (name: string) => FieldPresentation;
  disabled?: boolean;
}) {
  return (
    <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={disabled}>
      <Field label="Member since" required {...field("joinedAt")}>
        {(control) => (
          <TextInput
            {...control}
            name="joinedAt"
            type="date"
            value={draft.joinedOn}
            onInput={(event) => onDraft({ joinedOn: (event.target as HTMLInputElement).value })}
          />
        )}
      </Field>
      <Field label="Member until" help="Optional" {...field("leftAt")}>
        {(control) => (
          <TextInput
            {...control}
            name="leftAt"
            type="date"
            value={draft.leftOn}
            min={draft.joinedOn || undefined}
            onInput={(event) => onDraft({ leftOn: (event.target as HTMLInputElement).value })}
          />
        )}
      </Field>
    </fieldset>
  );
}
