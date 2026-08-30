import {
  MAILING_LIST_MODERATION_POLICIES,
  MAILING_LIST_MODERATION_POLICY_LABELS,
  MAILING_LIST_POSTING_POLICIES,
  MAILING_LIST_POSTING_POLICY_LABELS,
  MAILING_LIST_PURPOSES,
  MAILING_LIST_SUBSCRIPTION_DEFAULTS,
} from "../../../shared/schemas/mailing-lists";
import { EnumSelect } from "../EnumSelect";
import { MembershipCategoryPicker } from "../MembershipCategoryPicker";
import type { MailingListDraft } from "./model";

const POSTING_POLICY_OPTIONS = MAILING_LIST_POSTING_POLICIES.map((value) => ({
  value,
  label: MAILING_LIST_POSTING_POLICY_LABELS[value],
}));
const MODERATION_POLICY_OPTIONS = MAILING_LIST_MODERATION_POLICIES.map((value) => ({
  value,
  label: MAILING_LIST_MODERATION_POLICY_LABELS[value],
}));

export interface MailingListFormProps {
  draft: MailingListDraft;
  onChange: (patch: Partial<MailingListDraft>) => void;
  idPrefix?: string;
}

/** Canonical mailing-list configuration form used by group management. */
export function MailingListForm({ draft, onChange, idPrefix = "mailing-list" }: MailingListFormProps) {
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
      <div class="col-sm-3">
        <label class="form-label small" htmlFor={`${idPrefix}-ownership`}>
          Ownership
        </label>
        <input id={`${idPrefix}-ownership`} class="form-control form-control-sm" value="This group" readOnly />
      </div>
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
        <EnumSelect
          id={`${idPrefix}-posting-policy`}
          label="Posting policy"
          value={draft.postingPolicy}
          options={POSTING_POLICY_OPTIONS}
          required
          onChange={(value) => onChange({ postingPolicy: value })}
        />
      </div>
      <div class="col-sm-3">
        <EnumSelect
          id={`${idPrefix}-moderation-policy`}
          label="Moderation policy"
          value={draft.moderationPolicy}
          options={MODERATION_POLICY_OPTIONS}
          required
          onChange={(value) => onChange({ moderationPolicy: value })}
        />
      </div>
      <div class="col-sm-6">
        <MembershipCategoryPicker
          idPrefix={`${idPrefix}-auto-sync-categories`}
          label="Auto-sync categories"
          selected={draft.autoSyncCategories}
          onChange={(next) => onChange({ autoSyncCategories: next })}
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
