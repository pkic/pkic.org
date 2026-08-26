import { MAILING_LIST_PURPOSES, MAILING_LIST_SUBSCRIPTION_DEFAULTS } from "../../../shared/schemas/mailing-lists";
import type { MailingListDraft } from "./model";

export interface MailingListFormProps {
  draft: MailingListDraft;
  onChange: (patch: Partial<MailingListDraft>) => void;
  /** Global administration may edit ownership; group context must never expose it. */
  showGroupOwnership?: boolean;
  ownershipLabel?: string;
  idPrefix?: string;
}

/** Canonical mailing-list configuration form used by admin and group management. */
export function MailingListForm({
  draft,
  onChange,
  showGroupOwnership = true,
  ownershipLabel,
  idPrefix = "mailing-list",
}: MailingListFormProps) {
  return (
    <div class="row g-2">
      <div class="col-sm-4">
        <label class="form-label small" htmlFor={`${idPrefix}-email`}>
          Email
        </label>
        <input
          id={`${idPrefix}-email`}
          class="form-control form-control-sm"
          type="email"
          value={draft.email}
          required
          onInput={(event) => onChange({ email: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small" htmlFor={`${idPrefix}-label`}>
          Label
        </label>
        <input
          id={`${idPrefix}-label`}
          class="form-control form-control-sm"
          value={draft.label}
          required
          onInput={(event) => onChange({ label: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-2">
        <label class="form-label small" htmlFor={`${idPrefix}-purpose`}>
          Purpose
        </label>
        <select
          id={`${idPrefix}-purpose`}
          class="form-select form-select-sm"
          value={draft.purpose}
          onChange={(event) =>
            onChange({ purpose: (event.target as HTMLSelectElement).value as MailingListDraft["purpose"] })
          }
        >
          {MAILING_LIST_PURPOSES.map((purpose) => (
            <option value={purpose} key={purpose}>
              {purpose.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      {showGroupOwnership ? (
        <div class="col-sm-3">
          <label class="form-label small" htmlFor={`${idPrefix}-group`}>
            Group ID
          </label>
          <input
            id={`${idPrefix}-group`}
            class="form-control form-control-sm"
            placeholder="Optional for global lists"
            value={draft.groupId}
            onInput={(event) => onChange({ groupId: (event.target as HTMLInputElement).value })}
          />
        </div>
      ) : (
        <div class="col-sm-3">
          <label class="form-label small" htmlFor={`${idPrefix}-ownership`}>
            Ownership
          </label>
          <input
            id={`${idPrefix}-ownership`}
            class="form-control form-control-sm"
            value={ownershipLabel ?? "This group"}
            readOnly
          />
        </div>
      )}
      <div class="col-sm-3">
        <label class="form-label small" htmlFor={`${idPrefix}-subscription-default`}>
          Default subscription
        </label>
        <select
          id={`${idPrefix}-subscription-default`}
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
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div class="col-sm-3">
        <label class="form-label small" htmlFor={`${idPrefix}-posting-policy`}>
          Posting policy
        </label>
        <input
          id={`${idPrefix}-posting-policy`}
          class="form-control form-control-sm"
          value={draft.postingPolicy}
          required
          onInput={(event) => onChange({ postingPolicy: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small" htmlFor={`${idPrefix}-moderation-policy`}>
          Moderation policy
        </label>
        <input
          id={`${idPrefix}-moderation-policy`}
          class="form-control form-control-sm"
          value={draft.moderationPolicy}
          required
          onInput={(event) => onChange({ moderationPolicy: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small" htmlFor={`${idPrefix}-auto-sync-categories`}>
          Auto-sync categories
        </label>
        <input
          id={`${idPrefix}-auto-sync-categories`}
          class="form-control form-control-sm"
          placeholder="A,B,C (blank = all)"
          value={draft.autoSyncCategories}
          onInput={(event) => onChange({ autoSyncCategories: (event.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3 d-flex align-items-end gap-3">
        <div class="form-check">
          <input
            id={`${idPrefix}-primary-discussion`}
            class="form-check-input"
            type="checkbox"
            checked={draft.primaryDiscussion}
            onChange={(event) => onChange({ primaryDiscussion: (event.target as HTMLInputElement).checked })}
          />
          <label class="form-check-label small" htmlFor={`${idPrefix}-primary-discussion`}>
            Primary discussion
          </label>
        </div>
        <div class="form-check">
          <input
            id={`${idPrefix}-active`}
            class="form-check-input"
            type="checkbox"
            checked={draft.active}
            onChange={(event) => onChange({ active: (event.target as HTMLInputElement).checked })}
          />
          <label class="form-check-label small" htmlFor={`${idPrefix}-active`}>
            Active
          </label>
        </div>
      </div>
    </div>
  );
}
