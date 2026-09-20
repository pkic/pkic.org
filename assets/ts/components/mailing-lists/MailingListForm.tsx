import type { ComponentChildren } from "preact";
import { DescriptionList } from "../../ui/DescriptionList";
import { useMembershipCategoryLabels } from "../../hooks/useMembershipCategoryLabels";
import type { FieldPresentation } from "../../hooks/useContractForm";
import {
  MAILING_LIST_MODERATION_POLICIES,
  MAILING_LIST_MODERATION_POLICY_LABELS,
  MAILING_LIST_POSTING_POLICIES,
  MAILING_LIST_POSTING_POLICY_LABELS,
  MAILING_LIST_PURPOSES,
  MAILING_LIST_SUBSCRIPTION_DEFAULTS,
} from "../../../shared/schemas/mailing-lists";
import { Checkbox } from "../../ui/Checkbox";
import { FormSection } from "../../ui/FormSection";
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

/** A machine vocabulary read as words: `eligible_categories` becomes "Eligible categories". */
function humanize(value: string): string {
  if (value === "none") return "No automatic subscription";
  return value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}

export type MailingListFieldSection = "identity" | "audience" | "policy" | "standing";
function FieldGroup({
  title,
  description,
  children,
  heading,
}: {
  title: string;
  description?: ComponentChildren;
  children: ComponentChildren;
  heading: boolean;
}) {
  return heading ? (
    <FormSection title={title} description={description}>
      {children}
    </FormSection>
  ) : (
    <div class="pk-stack">{children}</div>
  );
}
export interface MailingListFormProps {
  sections?: readonly MailingListFieldSection[];
  sectionHeadings?: boolean;
  draft: MailingListDraft;
  onChange: (patch: Partial<MailingListDraft>) => void;
  idPrefix?: string;
  readOnly?: boolean;
  fields?: (name: string) => FieldPresentation;
}

/**
 * Canonical mailing-list configuration form used by group management.
 *
 * The fields are grouped by the question they answer (#50). They used to flow
 * as one undifferentiated grid, which on a wide screen put all seven of them
 * in a single row: the address, the display label, what the list is for, who
 * owns it, who is subscribed by default and two policies, side by side with
 * nothing saying which belonged with which. A reader could not tell where one
 * decision ended and the next began.
 *
 * Four groups, because there are four questions: what the list IS, who is on
 * it, what people may do on it, and whether it is running. `FormSection`
 * gives each a heading that outranks a field label, so a section title and a
 * field label are no longer the same typography twice (#53).
 *
 * `Field` owns each label, the generated control id and the `aria-describedby`
 * wiring; `EnumSelect` keeps the caller-supplied id, because its options are
 * addressed by that id from both the surface and the tests.
 */
export function MailingListForm({
  draft,
  onChange,
  idPrefix = "mailing-list",
  readOnly = false,
  fields = () => ({}),
  sections = ["identity", "audience", "policy", "standing"],
  sectionHeadings = true,
}: MailingListFormProps) {
  const categories = useMembershipCategoryLabels(
    readOnly && sections.includes("audience") && draft.autoSyncCategories.length > 0,
  );
  return (
    <div class={sections.length === 4 ? "portal-mailing-list-fields" : "pk-stack"}>
      {(sections.includes("identity") || sections.includes("audience")) && (
        <div class="pk-stack">
          {sections.includes("identity") && (
            <FieldGroup title="Identity" heading={sectionHeadings}>
              {readOnly ? (
                <DescriptionList
                  items={[
                    { term: "Email", value: <span class="pk-break">{draft.email}</span> },
                    { term: "Label", value: draft.label },
                  ]}
                />
              ) : (
                <>
                  <Field {...fields("email")} label="Email" required>
                    {(control) => (
                      <TextInput
                        {...control}
                        name="email"
                        type="email"
                        value={draft.email}
                        onInput={(event) => onChange({ email: (event.target as HTMLInputElement).value })}
                      />
                    )}
                  </Field>
                  <Field {...fields("label")} label="Label" required>
                    {(control) => (
                      <TextInput
                        {...control}
                        name="label"
                        value={draft.label}
                        onInput={(event) => onChange({ label: (event.target as HTMLInputElement).value })}
                      />
                    )}
                  </Field>
                </>
              )}
            </FieldGroup>
          )}

          {sections.includes("audience") && (
            <FieldGroup
              heading={sectionHeadings}
              title="Audience"
              /*
          Ownership was a text input with `readOnly` on it — a fact wearing a
          control's clothes, which is a thing a reader tries to type in. It is
          stated here instead, where the group it belongs to is the answer to
          "whose list is this".
        */
              description={
                readOnly ? undefined : "Owned by this group. Who receives mail, and who is subscribed automatically."
              }
            >
              {readOnly ? (
                <DescriptionList
                  items={[
                    { term: "Purpose", value: humanize(draft.purpose) },
                    { term: "Default subscription", value: humanize(draft.subscriptionDefault) },
                    {
                      term: "Membership categories",
                      value: draft.autoSyncCategories.length
                        ? draft.autoSyncCategories.map(categories.label).join(", ")
                        : "All membership categories",
                    },
                  ]}
                />
              ) : (
                <>
                  <Field {...fields("purpose")} label="Purpose">
                    {(control) => (
                      <Select
                        {...control}
                        name="purpose"
                        value={draft.purpose}
                        onChange={(event) =>
                          onChange({
                            purpose: (event.target as HTMLSelectElement).value as MailingListDraft["purpose"],
                          })
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
                  <Field {...fields("subscriptionDefault")} label="Default subscription">
                    {(control) => (
                      <Select
                        {...control}
                        name="subscriptionDefault"
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
                  <MembershipCategoryPicker
                    idPrefix={`${idPrefix}-auto-sync-categories`}
                    label="Subscribe these membership categories automatically"
                    selected={draft.autoSyncCategories}
                    onChange={(next) => onChange({ autoSyncCategories: next })}
                  />
                </>
              )}
            </FieldGroup>
          )}
        </div>
      )}
      {(sections.includes("policy") || sections.includes("standing")) && (
        <div class="pk-stack">
          {sections.includes("policy") && (
            <FieldGroup
              heading={sectionHeadings}
              title="Policy"
              description={readOnly ? undefined : "Who can send messages and which messages need approval."}
            >
              {readOnly ? (
                <DescriptionList
                  items={[
                    { term: "Who can post", value: MAILING_LIST_POSTING_POLICY_LABELS[draft.postingPolicy] },
                    { term: "Moderation", value: MAILING_LIST_MODERATION_POLICY_LABELS[draft.moderationPolicy] },
                  ]}
                />
              ) : (
                <>
                  <Field {...fields("postingPolicy")} label="Posting policy" required>
                    {(control) => (
                      <EnumSelect
                        {...control}
                        name="postingPolicy"
                        value={draft.postingPolicy}
                        options={POSTING_POLICY_OPTIONS}
                        onChange={(value) => onChange({ postingPolicy: value })}
                      />
                    )}
                  </Field>
                  <Field {...fields("moderationPolicy")} label="Moderation policy" required>
                    {(control) => (
                      <EnumSelect
                        {...control}
                        name="moderationPolicy"
                        value={draft.moderationPolicy}
                        options={MODERATION_POLICY_OPTIONS}
                        onChange={(value) => onChange({ moderationPolicy: value })}
                      />
                    )}
                  </Field>
                </>
              )}
            </FieldGroup>
          )}

          {sections.includes("standing") && (
            <FieldGroup title="Standing" heading={sectionHeadings}>
              {readOnly ? (
                <DescriptionList
                  items={[
                    { term: "Status", value: draft.active ? "Active" : "Inactive" },
                    { term: "Primary discussion", value: draft.primaryDiscussion ? "Yes" : "No" },
                  ]}
                />
              ) : (
                <>
                  {/*
          Two checkboxes with nothing over them read as two stray options at
          the foot of a form. They are one answer — what this list is to the
          group right now — so they are one labelled group, and the legend is
          a field label rather than a section heading because the words name
          the answer rather than opening a set of questions.
        */}
                  <fieldset class="pk-fieldset pk-field">
                    <legend class="pk-field__label">This list is</legend>
                    <div class="pk-stack pk-stack--tight">
                      <Checkbox
                        id={`${idPrefix}-active`}
                        checked={draft.active}
                        onChange={(event) => onChange({ active: (event.target as HTMLInputElement).checked })}
                        label={<span id={`${idPrefix}-active-label`}>List enabled</span>}
                        aria-labelledby={`${idPrefix}-active-label`}
                        aria-describedby={`${idPrefix}-active-help`}
                        hint={
                          <span id={`${idPrefix}-active-help`}>
                            Disabling hides this list from subscription choices and queues removal of managed
                            subscribers from Google Groups. Saved preferences are kept. To keep subscribers while
                            pausing updates, turn off synchronization instead.
                          </span>
                        }
                      />
                      <Checkbox
                        id={`${idPrefix}-primary-discussion`}
                        checked={draft.primaryDiscussion}
                        onChange={(event) =>
                          onChange({ primaryDiscussion: (event.target as HTMLInputElement).checked })
                        }
                        label="The group's primary discussion list"
                      />
                    </div>
                  </fieldset>
                </>
              )}
            </FieldGroup>
          )}
        </div>
      )}
    </div>
  );
}
