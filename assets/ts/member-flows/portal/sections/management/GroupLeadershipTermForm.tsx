import { useState } from "preact/hooks";
import {
  groupLeadershipListResponseSchema,
  groupLeadershipTitleChoices,
  groupLeadershipUpdateSchema,
  type GroupLeadershipAssignment,
  type GroupLeadershipRoleId,
  type GroupLeadershipTitleOptions,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { ApiClientError, patchJson } from "../../../../shared/api-client";
import type { FieldControlProps } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";

/**
 * The title control: a choice, from the vocabulary the server offers for this
 * role. Control-only, so its caller's `Field` names it.
 */
export function GroupLeadershipTitleInput({
  titleOptions,
  roleId,
  value,
  disabled,
  onChange,
  ...control
}: FieldControlProps & {
  titleOptions: GroupLeadershipTitleOptions;
  roleId: GroupLeadershipRoleId;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  /*
   * The titles this role actually has, offered as a choice.
   *
   * This was a text box with a datalist behind it, which is free text wearing
   * a suggestion list: the browser shows the options only once somebody starts
   * typing, so a chair was something you had to know to write rather than
   * something the form offered (issue #29). The set is small and known, so it
   * is a select — and the options are the leadership response's own
   * `titleOptions`, which the server builds from the group type's configured
   * title and the `group_leadership_titles` reference table. A title the
   * consortium has not used yet is added as a row there; it is never typed
   * here, because a vocabulary a frontend can invent is not a vocabulary.
   *
   * A title already saved that is not among them is kept as an option, because
   * opening the form on an assignment must never be able to change it by
   * itself — that is how a historical "Board Chair" survives an edit to its
   * term.
   */
  const options = groupLeadershipTitleChoices(titleOptions, roleId);
  const withCurrent = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select
      {...control}
      required
      value={value}
      disabled={disabled}
      onChange={(event) => onChange((event.target as HTMLSelectElement).value)}
    >
      {withCurrent.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  );
}

/** Edits the title or term of one local assignment; clearing the end reopens a closed term. */
export function GroupLeadershipTermForm({
  groupId,
  assignment,
  titleOptions,
  onSaved,
  onCancel,
}: {
  groupId: string;
  assignment: GroupLeadershipAssignment;
  titleOptions: GroupLeadershipTitleOptions;
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
    // This is the primary heading on the term page.
    <Panel class="pk" aria-label={`Edit term for ${assignment.userName}`}>
      <PanelHeader title={`Edit term for ${assignment.userName}`} headingLevel={2} breadcrumb>
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
                  titleOptions={titleOptions}
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
