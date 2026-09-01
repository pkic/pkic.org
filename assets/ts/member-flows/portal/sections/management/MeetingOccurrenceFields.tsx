/**
 * The fields describing one meeting occurrence, shared by the create form and
 * the occurrence settings form.
 *
 * Every control carries an explicit `for`/`id` pair built from `idPrefix`
 * rather than going through `Field`, because `idPrefix` is this component's
 * public contract: its callers address these controls by that prefix, and a
 * generated id would quietly break them. `LabelledField` hands the id down to
 * the control it names, so the pair cannot drift the way two hand-written
 * attributes can.
 *
 * The fields are one `pk-grid`, whose columns are as many as fit rather than a
 * breakpoint triplet written per field. The create form and the settings form
 * then reflow from the same markup instead of each choosing its own widths.
 */

import type { ComponentChildren } from "preact";
import { EVENT_OCCURRENCE_STATUSES, type EventOccurrenceStatus } from "../../../../../shared/schemas/event-series";
import { Select, TextInput } from "../../../../ui/TextControl";
import "../../../../ui/Field.css";

export type ProviderUrlAction = "keep" | "replace" | "remove";

export interface MeetingOccurrenceDraft {
  startsAt: string;
  endsAt: string;
  status: EventOccurrenceStatus;
  location: string;
  providerUrlAction: ProviderUrlAction;
  providerJoinUrl: string;
}

/** What a control inside a `LabelledField` must spread onto its element. */
interface LabelledControlProps {
  id: string;
  required?: true;
  "aria-describedby"?: string;
}

/**
 * A label and the control it names, paired by a caller-chosen id.
 *
 * The same shape as `Field`'s render prop, so a control moves between the two
 * without being rewritten — the only difference is who picks the id.
 */
function LabelledField({
  id,
  label,
  required = false,
  describedBy,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  describedBy?: string;
  children: (control: LabelledControlProps) => ComponentChildren;
}) {
  return (
    <div class="pk-stack pk-stack--tight">
      <label class="pk-field__label" for={id}>
        {label}
        {required && (
          <span class="pk-field__required">
            <span aria-hidden="true">*</span>
            <span class="pk-field__sr">(required)</span>
          </span>
        )}
      </label>
      {children({ id, required: required || undefined, "aria-describedby": describedBy })}
    </div>
  );
}

function updateDraft<K extends keyof MeetingOccurrenceDraft>(
  draft: MeetingOccurrenceDraft,
  onChange: (draft: MeetingOccurrenceDraft) => void,
  key: K,
  value: MeetingOccurrenceDraft[K],
): void {
  onChange({ ...draft, [key]: value });
}

export function MeetingOccurrenceFields({
  idPrefix,
  draft,
  existing = false,
  providerConfigured = false,
  disabled = false,
  onChange,
}: {
  idPrefix: string;
  draft: MeetingOccurrenceDraft;
  existing?: boolean;
  providerConfigured?: boolean;
  disabled?: boolean;
  onChange: (draft: MeetingOccurrenceDraft) => void;
}) {
  const providerHelpId = `${idPrefix}-provider-help`;
  const showProviderAction = existing && providerConfigured;
  const showProviderUrl = !existing || !providerConfigured || draft.providerUrlAction === "replace";

  return (
    <div class="pk pk-grid">
      <LabelledField id={`${idPrefix}-starts`} label="Starts" required>
        {(control) => (
          <TextInput
            {...control}
            type="datetime-local"
            value={draft.startsAt}
            disabled={disabled}
            onInput={(event) => updateDraft(draft, onChange, "startsAt", event.currentTarget.value)}
          />
        )}
      </LabelledField>

      <LabelledField id={`${idPrefix}-ends`} label="Ends" required>
        {(control) => (
          <TextInput
            {...control}
            type="datetime-local"
            value={draft.endsAt}
            disabled={disabled}
            onInput={(event) => updateDraft(draft, onChange, "endsAt", event.currentTarget.value)}
          />
        )}
      </LabelledField>

      {existing && (
        <LabelledField id={`${idPrefix}-status`} label="Status">
          {(control) => (
            <Select
              {...control}
              value={draft.status}
              disabled={disabled}
              onChange={(event) =>
                updateDraft(draft, onChange, "status", event.currentTarget.value as EventOccurrenceStatus)
              }
            >
              {EVENT_OCCURRENCE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          )}
        </LabelledField>
      )}

      <LabelledField id={`${idPrefix}-location`} label="Location override">
        {(control) => (
          <TextInput
            {...control}
            value={draft.location}
            disabled={disabled}
            onInput={(event) => updateDraft(draft, onChange, "location", event.currentTarget.value)}
          />
        )}
      </LabelledField>

      <div class="pk-stack pk-stack--snug">
        {showProviderAction && (
          <LabelledField id={`${idPrefix}-provider-action`} label="Meeting-provider URL" describedBy={providerHelpId}>
            {(control) => (
              <Select
                {...control}
                value={draft.providerUrlAction}
                disabled={disabled}
                onChange={(event) =>
                  updateDraft(draft, onChange, "providerUrlAction", event.currentTarget.value as ProviderUrlAction)
                }
              >
                <option value="keep">Keep configured URL</option>
                <option value="replace">Replace configured URL</option>
                <option value="remove">Remove configured URL</option>
              </Select>
            )}
          </LabelledField>
        )}
        {showProviderUrl && (
          <LabelledField
            id={`${idPrefix}-provider-url`}
            label={providerConfigured ? "Replacement URL" : "Meeting-provider URL"}
            required={existing && providerConfigured && draft.providerUrlAction === "replace"}
            describedBy={providerHelpId}
          >
            {(control) => (
              <TextInput
                {...control}
                type="url"
                value={draft.providerJoinUrl}
                disabled={disabled}
                onInput={(event) => updateDraft(draft, onChange, "providerJoinUrl", event.currentTarget.value)}
              />
            )}
          </LabelledField>
        )}
        <p class="pk-small" id={providerHelpId}>
          The provider URL is encrypted and never returned by the API.
        </p>
      </div>
    </div>
  );
}
