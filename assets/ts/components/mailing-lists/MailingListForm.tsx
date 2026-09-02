import {
  MAILING_LIST_MODERATION_POLICIES,
  MAILING_LIST_MODERATION_POLICY_LABELS,
  MAILING_LIST_POSTING_POLICIES,
  MAILING_LIST_POSTING_POLICY_LABELS,
  MAILING_LIST_PURPOSES,
  MAILING_LIST_SUBSCRIPTION_DEFAULTS,
} from "../../../shared/schemas/mailing-lists";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
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

/** A machine vocabulary read as words: `eligible_categories` becomes "eligible categories". */
function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

export interface MailingListFormProps {
  draft: MailingListDraft;
  onChange: (patch: Partial<MailingListDraft>) => void;
  idPrefix?: string;
}

/**
 * Canonical mailing-list configuration form used by group management.
 *
 * The fields flow in one responsive grid rather than a twelve-column row: the
 * columns are as many as fit at the grid's minimum, so the same markup serves
 * a phone and a wide desktop without a `col-sm-*` triplet per field. `Field`
 * owns each label, the generated control id and the `aria-describedby` wiring;
 * `EnumSelect` keeps the caller-supplied id, because its options are addressed
 * by that id from both the surface and the tests.
 */
export function MailingListForm({ draft, onChange, idPrefix = "mailing-list" }: MailingListFormProps) {
  return (
    <div class="pk-stack pk-stack--snug">
      <div class="pk-grid pk-grid--tight">
        <Field label="Email" required>
          {(control) => (
            <TextInput
              {...control}
              type="email"
              value={draft.email}
              onInput={(event) => onChange({ email: (event.target as HTMLInputElement).value })}
            />
          )}
        </Field>
        <Field label="Label" required>
          {(control) => (
            <TextInput
              {...control}
              value={draft.label}
              onInput={(event) => onChange({ label: (event.target as HTMLInputElement).value })}
            />
          )}
        </Field>
        <Field label="Purpose">
          {(control) => (
            <Select
              {...control}
              value={draft.purpose}
              onChange={(event) =>
                onChange({ purpose: (event.target as HTMLSelectElement).value as MailingListDraft["purpose"] })
              }
            >
              {MAILING_LIST_PURPOSES.map((purpose) => (
                <option value={purpose} key={purpose}>
                  {humanize(purpose)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Ownership" help="Set by the group this list belongs to.">
          {(control) => <TextInput {...control} value="This group" readOnly />}
        </Field>
        <Field label="Default subscription">
          {(control) => (
            <Select
              {...control}
              value={draft.subscriptionDefault}
              onChange={(event) =>
                onChange({
                  subscriptionDefault: (event.target as HTMLSelectElement)
                    .value as MailingListDraft["subscriptionDefault"],
                })
              }
            >
              {MAILING_LIST_SUBSCRIPTION_DEFAULTS.map((value) => (
                <option value={value} key={value}>
                  {humanize(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Posting policy" required>
          {(control) => (
            <EnumSelect
              {...control}
              value={draft.postingPolicy}
              options={POSTING_POLICY_OPTIONS}
              onChange={(value) => onChange({ postingPolicy: value })}
            />
          )}
        </Field>
        <Field label="Moderation policy" required>
          {(control) => (
            <EnumSelect
              {...control}
              value={draft.moderationPolicy}
              options={MODERATION_POLICY_OPTIONS}
              onChange={(value) => onChange({ moderationPolicy: value })}
            />
          )}
        </Field>
      </div>

      <MembershipCategoryPicker
        idPrefix={`${idPrefix}-auto-sync-categories`}
        label="Auto-sync categories"
        selected={draft.autoSyncCategories}
        onChange={(next) => onChange({ autoSyncCategories: next })}
      />

      <div class="pk-cluster">
        <Checkbox
          id={`${idPrefix}-primary-discussion`}
          checked={draft.primaryDiscussion}
          onChange={(event) => onChange({ primaryDiscussion: (event.target as HTMLInputElement).checked })}
          label="Primary discussion"
        />
        <Checkbox
          id={`${idPrefix}-active`}
          checked={draft.active}
          onChange={(event) => onChange({ active: (event.target as HTMLInputElement).checked })}
          label="Active"
        />
      </div>
    </div>
  );
}
