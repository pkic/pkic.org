import { EVENT_OCCURRENCE_STATUSES, type EventOccurrenceStatus } from "../../../../../shared/schemas/event-series";

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
  return (
    <div class="row g-2">
      <div class={existing ? "col-md-4" : "col-md-3"}>
        <label class="form-label small fw-semibold" for={`${idPrefix}-starts`}>
          Starts
        </label>
        <input
          id={`${idPrefix}-starts`}
          type="datetime-local"
          class="form-control form-control-sm"
          value={draft.startsAt}
          required
          disabled={disabled}
          onInput={(event) => updateDraft(draft, onChange, "startsAt", event.currentTarget.value)}
        />
      </div>
      <div class={existing ? "col-md-4" : "col-md-3"}>
        <label class="form-label small fw-semibold" for={`${idPrefix}-ends`}>
          Ends
        </label>
        <input
          id={`${idPrefix}-ends`}
          type="datetime-local"
          class="form-control form-control-sm"
          value={draft.endsAt}
          required
          disabled={disabled}
          onInput={(event) => updateDraft(draft, onChange, "endsAt", event.currentTarget.value)}
        />
      </div>
      {existing && (
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for={`${idPrefix}-status`}>
            Status
          </label>
          <select
            id={`${idPrefix}-status`}
            class="form-select form-select-sm"
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
          </select>
        </div>
      )}
      <div class={existing ? "col-md-6" : "col-md-3"}>
        <label class="form-label small fw-semibold" for={`${idPrefix}-location`}>
          Location override
        </label>
        <input
          id={`${idPrefix}-location`}
          class="form-control form-control-sm"
          value={draft.location}
          disabled={disabled}
          onInput={(event) => updateDraft(draft, onChange, "location", event.currentTarget.value)}
        />
      </div>
      <div class={existing ? "col-md-6" : "col-md-3"}>
        {existing && providerConfigured && (
          <>
            <label class="form-label small fw-semibold" for={`${idPrefix}-provider-action`}>
              Meeting-provider URL
            </label>
            <select
              id={`${idPrefix}-provider-action`}
              class="form-select form-select-sm mb-2"
              value={draft.providerUrlAction}
              disabled={disabled}
              onChange={(event) =>
                updateDraft(draft, onChange, "providerUrlAction", event.currentTarget.value as ProviderUrlAction)
              }
            >
              <option value="keep">Keep configured URL</option>
              <option value="replace">Replace configured URL</option>
              <option value="remove">Remove configured URL</option>
            </select>
          </>
        )}
        {(!existing || !providerConfigured || draft.providerUrlAction === "replace") && (
          <>
            <label class="form-label small fw-semibold" for={`${idPrefix}-provider-url`}>
              {providerConfigured ? "Replacement URL" : "Meeting-provider URL"}
            </label>
            <input
              id={`${idPrefix}-provider-url`}
              type="url"
              class="form-control form-control-sm"
              value={draft.providerJoinUrl}
              required={existing && providerConfigured && draft.providerUrlAction === "replace"}
              disabled={disabled}
              onInput={(event) => updateDraft(draft, onChange, "providerJoinUrl", event.currentTarget.value)}
            />
          </>
        )}
        <div class="form-text">The provider URL is encrypted and never returned by the API.</div>
      </div>
    </div>
  );
}
