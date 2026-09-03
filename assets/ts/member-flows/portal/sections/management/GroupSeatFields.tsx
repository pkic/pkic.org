/**
 * A seat's own fields: what the seat is called on the published roster, and
 * the service interval it covers. Adding a person and editing an existing
 * seat ask for the same three things, so they ask in one place.
 */
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";

export interface GroupSeatDraft {
  title: string;
  joinedOn: string;
  leftOn: string;
}

export function GroupSeatFields({
  draft,
  onDraft,
  /** Omitted while a seat is being opened and no end is being recorded. */
  showEnd = true,
  endRequired = false,
}: {
  draft: GroupSeatDraft;
  onDraft: (patch: Partial<GroupSeatDraft>) => void;
  showEnd?: boolean;
  endRequired?: boolean;
}) {
  return (
    <>
      <Field label="Seat title" help="Optional. Shown as “Member” when left blank.">
        {(control) => (
          <TextInput
            {...control}
            maxLength={80}
            placeholder="Member"
            value={draft.title}
            onInput={(event) => onDraft({ title: (event.target as HTMLInputElement).value })}
          />
        )}
      </Field>
      <Field label="Member since" required>
        {(control) => (
          <TextInput
            {...control}
            type="date"
            value={draft.joinedOn}
            onInput={(event) => onDraft({ joinedOn: (event.target as HTMLInputElement).value })}
          />
        )}
      </Field>
      {showEnd && (
        <Field
          label="Member until"
          required={endRequired}
          help={endRequired ? undefined : "Optional. Closing a seat also ends leadership held through it."}
        >
          {(control) => (
            <TextInput
              {...control}
              type="date"
              value={draft.leftOn}
              min={draft.joinedOn || undefined}
              onInput={(event) => onDraft({ leftOn: (event.target as HTMLInputElement).value })}
            />
          )}
        </Field>
      )}
    </>
  );
}
