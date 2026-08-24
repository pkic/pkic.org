import { MAILING_LIST_PURPOSES, MAILING_LIST_SUBSCRIPTION_DEFAULTS } from "../../../../shared/schemas/mailing-lists";
import type { MailingListDraft } from "./model";

export function MailingListForm({
  draft,
  onChange,
}: {
  draft: MailingListDraft;
  onChange: (patch: Partial<MailingListDraft>) => void;
}) {
  return (
    <div class="row g-2">
      <div class="col-sm-4">
        <label class="form-label small">Email</label>
        <input
          class="form-control form-control-sm"
          value={draft.email}
          onInput={(event) => onChange({ email: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small">Label</label>
        <input
          class="form-control form-control-sm"
          value={draft.label}
          onInput={(event) => onChange({ label: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-2">
        <label class="form-label small">Purpose</label>
        <select
          class="form-select form-select-sm"
          value={draft.purpose}
          onChange={(event) =>
            onChange({ purpose: (event.target as HTMLSelectElement).value as MailingListDraft["purpose"] })
          }
        >
          {MAILING_LIST_PURPOSES.map((purpose) => (
            <option value={purpose} key={purpose}>
              {purpose}
            </option>
          ))}
        </select>
      </div>
      <div class="col-sm-3">
        <label class="form-label small">Group ID</label>
        <input
          class="form-control form-control-sm"
          placeholder="Required for group lists"
          value={draft.groupId}
          onInput={(event) => onChange({ groupId: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small">Default subscription</label>
        <select
          class="form-select form-select-sm"
          value={draft.subscriptionDefault}
          onChange={(event) =>
            onChange({
              subscriptionDefault: (event.target as HTMLSelectElement).value as MailingListDraft["subscriptionDefault"],
            })
          }
        >
          {MAILING_LIST_SUBSCRIPTION_DEFAULTS.map((value) => (
            <option value={value} key={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div class="col-sm-3">
        <label class="form-label small">Posting policy</label>
        <input
          class="form-control form-control-sm"
          value={draft.postingPolicy}
          onInput={(event) => onChange({ postingPolicy: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small">Moderation policy</label>
        <input
          class="form-control form-control-sm"
          value={draft.moderationPolicy}
          onInput={(event) => onChange({ moderationPolicy: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small">Auto-sync categories</label>
        <input
          class="form-control form-control-sm"
          placeholder="A,B,C (blank = all)"
          value={draft.autoSyncCategories}
          onInput={(event) => onChange({ autoSyncCategories: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3 d-flex align-items-end gap-3">
        <div class="form-check">
          <input
            class="form-check-input"
            type="checkbox"
            checked={draft.primaryDiscussion}
            onChange={(event) => onChange({ primaryDiscussion: (event.target as HTMLInputElement).checked })}
          />
          <label class="form-check-label small">Primary discussion</label>
        </div>
        <div class="form-check">
          <input
            class="form-check-input"
            type="checkbox"
            checked={draft.active}
            onChange={(event) => onChange({ active: (event.target as HTMLInputElement).checked })}
          />
          <label class="form-check-label small">Active</label>
        </div>
      </div>
    </div>
  );
}
