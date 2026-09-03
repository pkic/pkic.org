import { useId, useState } from "preact/hooks";
import {
  groupLeadershipListResponseSchema,
  groupLeadershipUpdateSchema,
  type GroupLeadershipAssignment,
  type GroupLeadershipRoleId,
  type GroupLeadershipTitles,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { ApiClientError, patchJson } from "../../../../shared/api-client";
import type { FieldControlProps } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";
import { groupLeadershipTitleOptions } from "./group-leadership";

/**
 * A title control that suggests the group type's default and the shared
 * vocabulary while accepting anything: the suggestions are a shortcut, the
 * text is the contract. Control-only, so its caller's `Field` names it.
 */
export function GroupLeadershipTitleInput({
  titles,
  roleId,
  value,
  disabled,
  onChange,
  ...control
}: FieldControlProps & {
  titles: GroupLeadershipTitles;
  roleId: GroupLeadershipRoleId;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const listId = `${useId()}-titles`;
  return (
    <>
      <TextInput
        {...control}
        list={listId}
        maxLength={80}
        required
        value={value}
        disabled={disabled}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
      <datalist id={listId}>
        {groupLeadershipTitleOptions(titles, roleId).map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}

/** Edits the title or term of one local assignment; clearing the end reopens a closed term. */
export function GroupLeadershipTermForm({
  groupId,
  assignment,
  titles,
  onSaved,
  onCancel,
}: {
  groupId: string;
  assignment: GroupLeadershipAssignment;
  titles: GroupLeadershipTitles;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(assignment.title);
  const [startsOn, setStartsOn] = useState(toCalendarDateInput(assignment.startsAt));
  const [endsOn, setEndsOn] = useState(toCalendarDateInput(assignment.endsAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const patch = groupLeadershipUpdateSchema.parse({
        title: title.trim(),
        startsAt: fromCalendarDateInput(startsOn) ?? undefined,
        endsAt: fromCalendarDateInput(endsOn),
      });
      await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership/${encodeURIComponent(assignment.userRoleId)}`,
        patch,
        groupLeadershipListResponseSchema,
      );
      await onSaved();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not update this leadership term.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // Nested inside the tab's panel, so its heading is one rung below that
    // panel's rather than another <h3> beside it.
    <Panel class="pk" aria-label={`Edit term for ${assignment.userName}`}>
      <PanelHeader title={`Edit term for ${assignment.userName}`} headingLevel={4}>
        <Button size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </PanelHeader>
      <PanelBody>
        <form class="pk-stack pk-stack--snug" onSubmit={(event) => void submit(event)}>
          <p class="pk-muted pk-small">
            An end date in the past closes the term; a future one schedules the hand-over; none keeps it open.
          </p>
          {error && <ErrorAlert error={error} />}
          <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={saving}>
            <Field label="Title" required>
              {(control) => (
                <GroupLeadershipTitleInput
                  {...control}
                  titles={titles}
                  roleId={assignment.roleId}
                  value={title}
                  disabled={saving}
                  onChange={setTitle}
                />
              )}
            </Field>
            <Field label="Term starts" required>
              {(control) => (
                <TextInput
                  {...control}
                  type="date"
                  value={startsOn}
                  onInput={(event) => setStartsOn((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Field label="Term ends" help="Optional. An end date in the past closes the term.">
              {(control) => (
                <TextInput
                  {...control}
                  type="date"
                  value={endsOn}
                  min={startsOn || undefined}
                  onInput={(event) => setEndsOn((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
          </fieldset>
          <div class="pk-cluster">
            <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!title.trim() || !startsOn}>
              {saving ? "Saving…" : "Save term"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
