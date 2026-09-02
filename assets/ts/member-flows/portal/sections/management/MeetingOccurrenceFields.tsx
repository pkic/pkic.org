/**
 * The fields describing one meeting occurrence, shared by the create form and
 * the occurrence settings form.
 *
 * Every control is a design-system `Field`, which owns the label, the required
 * marker and the control's id; the parent forms reach a control through the
 * label that names it. The encryption note under the provider controls is one
 * paragraph both of them describe themselves by, rather than a help text
 * repeated under each.
 *
 * The fields are one `pk-grid`, whose columns are as many as fit rather than a
 * breakpoint triplet written per field. The create form and the settings form
 * then reflow from the same markup instead of each choosing its own widths.
 */

import { useId } from "preact/hooks";
import { EVENT_OCCURRENCE_STATUSES, type EventOccurrenceStatus } from "../../../../../shared/schemas/event-series";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";

export type ProviderUrlAction = "keep" | "replace" | "remove";

export interface MeetingOccurrenceDraft {
  startsAt: string;
  endsAt: string;
  status: EventOccurrenceStatus;
  location: string;
  providerUrlAction: ProviderUrlAction;
  providerJoinUrl: string;
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
  draft,
  existing = false,
  providerConfigured = false,
  disabled = false,
  onChange,
}: {
  draft: MeetingOccurrenceDraft;
  existing?: boolean;
  providerConfigured?: boolean;
  disabled?: boolean;
  onChange: (draft: MeetingOccurrenceDraft) => void;
}) {
  const providerHelpId = `${useId()}-provider-help`;
  const showProviderAction = existing && providerConfigured;
  const showProviderUrl = !existing || !providerConfigured || draft.providerUrlAction === "replace";

  return (
    <div class="pk pk-grid">
      <Field label="Starts" required>
        {(control) => (
          <TextInput
            {...control}
            type="datetime-local"
            value={draft.startsAt}
            disabled={disabled}
            onInput={(event) => updateDraft(draft, onChange, "startsAt", event.currentTarget.value)}
          />
        )}
      </Field>

      <Field label="Ends" required>
        {(control) => (
          <TextInput
            {...control}
            type="datetime-local"
            value={draft.endsAt}
            disabled={disabled}
            onInput={(event) => updateDraft(draft, onChange, "endsAt", event.currentTarget.value)}
          />
        )}
      </Field>

      {existing && (
        <Field label="Status">
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
        </Field>
      )}

      <Field label="Location override">
        {(control) => (
          <TextInput
            {...control}
            value={draft.location}
            disabled={disabled}
            onInput={(event) => updateDraft(draft, onChange, "location", event.currentTarget.value)}
          />
        )}
      </Field>

      <div class="pk-stack pk-stack--snug">
        {showProviderAction && (
          <Field label="Meeting-provider URL">
            {(control) => (
              <Select
                {...control}
                aria-describedby={providerHelpId}
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
          </Field>
        )}
        {showProviderUrl && (
          <Field
            label={providerConfigured ? "Replacement URL" : "Meeting-provider URL"}
            required={existing && providerConfigured && draft.providerUrlAction === "replace"}
          >
            {(control) => (
              <TextInput
                {...control}
                aria-describedby={providerHelpId}
                type="url"
                value={draft.providerJoinUrl}
                disabled={disabled}
                onInput={(event) => updateDraft(draft, onChange, "providerJoinUrl", event.currentTarget.value)}
              />
            )}
          </Field>
        )}
        <p class="pk-small" id={providerHelpId}>
          The provider URL is encrypted and never returned by the API.
        </p>
      </div>
    </div>
  );
}
