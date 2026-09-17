import { MembershipWorkflowSelect } from "../../../../components/MembershipWorkflowSelect";
import { memberJoinApplicantKindSchema } from "../../../../../shared/schemas/member-join";
import { useState } from "preact/hooks";
import {
  MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH,
  MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH,
  membershipCategoryCreateSchema,
  membershipCategoryUpdateSchema,
  membershipCategoryResponseSchema,
  type MembershipCategoryCatalogEntry,
} from "../../../../../shared/schemas/membership-categories";
import { useContractForm } from "../../../../hooks/useContractForm";
import { invalidateMembershipCategoryCatalog } from "../../../../hooks/useMembershipCategoryCatalog";
import { postJson, patchJson } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";
import { CategoryStanding } from "./MembershipCategoryStanding";
const CATEGORIES_API = "/api/v1/membership/categories";
const CATEGORIES_PATH = "/settings/membership-categories";

/**
 * Editing one category: a page at the category's own address, reached from
 * its row, with the list as the way back. Never a form unfolding inside the
 * list.
 */
export function MembershipCategoryForm({
  category,
  canWrite,
  onSaved,
}: {
  category?: MembershipCategoryCatalogEntry;
  canWrite: boolean;
  onSaved: () => Promise<void>;
}) {
  const [, navigate] = usePortalHashLocation();
  const [draft, setDraft] = useState<MembershipCategoryCatalogEntry>(
    category ?? {
      code: "",
      label: "",
      description: null,
      displayOrder: 0,
      isIndividual: false,
      requiresUniversityEmail: false,
      isVoting: false,
      active: true,
      workflowVersionId: null,
      revision: 0,
      updatedAt: "",
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(category ? membershipCategoryUpdateSchema : membershipCategoryCreateSchema, {
    ...(category
      ? { expectedRevision: category.revision }
      : { code: draft.code, isIndividual: draft.isIndividual, requiresUniversityEmail: draft.requiresUniversityEmail }),
    label: draft.label,
    description: draft.description,
    displayOrder: draft.displayOrder,
    isVoting: draft.isVoting,
    active: draft.active,
    workflowVersionId: draft.workflowVersionId,
  });
  const title = category ? `${category.label} (${category.code})` : "New membership category";
  const trail = [
    { label: "Settings", href: usePortalHashLocation.hrefs("/settings") },
    { label: "Membership categories", href: usePortalHashLocation.hrefs(CATEGORIES_PATH) },
  ];

  async function save(event: Event) {
    event.preventDefault();
    if (!canWrite || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setError("");
    setSaving(true);
    try {
      if (category)
        await patchJson(
          `${CATEGORIES_API}/${encodeURIComponent(category.code)}`,
          checked.data,
          membershipCategoryResponseSchema,
        );
      else await postJson(CATEGORIES_API, checked.data, membershipCategoryResponseSchema);
      invalidateMembershipCategoryCatalog();
      toast(`Category ${draft.code} saved`, "success");
      await onSaved();
      navigate(CATEGORIES_PATH);
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pk pk-stack">
      <PageHeader
        trail={trail}
        eyebrow="Membership category"
        title={title}
        context={category ? <CategoryStanding category={category} /> : undefined}
      />
      <Panel aria-label={title}>
        <PanelHeader title="Category settings" />
        <PanelBody>
          <form
            class="pk-stack"
            aria-label={category ? `Edit category ${category.code}` : "Create membership category"}
            noValidate
            {...form.handlers}
            onSubmit={(event) => void save(event)}
            autocomplete="off"
          >
            {/* One `disabled` on the group rather than one per control. A
                reader without membership:write sees the values and no way to
                change them. */}
            <fieldset class="pk-fieldset pk-stack" disabled={!canWrite || saving}>
              {!category && (
                <>
                  <Field
                    label="Code"
                    required
                    help="A permanent uppercase identifier, such as ORG_PAID or IND_PAID."
                    {...form.of("code")}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        name="code"
                        value={draft.code}
                        maxlength={32}
                        onInput={(event) => setDraft({ ...draft, code: event.currentTarget.value })}
                      />
                    )}
                  </Field>
                  <Field label="Held by" {...form.of("isIndividual")}>
                    {(control) => (
                      <Select
                        {...control}
                        name="isIndividual"
                        value={draft.isIndividual ? "individual" : "organization"}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            isIndividual: event.currentTarget.value === "individual",
                            requiresUniversityEmail: false,
                          })
                        }
                      >
                        {memberJoinApplicantKindSchema.options.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind === "individual" ? "Individual users" : "Organizations"}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {draft.isIndividual && (
                    <Checkbox
                      name="requiresUniversityEmail"
                      checked={draft.requiresUniversityEmail}
                      label="Require a university email address"
                      onChange={(event) => setDraft({ ...draft, requiresUniversityEmail: event.currentTarget.checked })}
                    />
                  )}
                  <p class="pk-small pk-muted">
                    The code and holder type stay fixed after creation. Configure group eligibility separately before
                    enrolling members.
                  </p>
                </>
              )}
              <Field
                label="Membership workflow"
                help="Select a published version for new applications. Existing applications retain their policy. Categories without a workflow are unavailable on the join form."
                {...form.of("workflowVersionId")}
              >
                {(control) => (
                  <MembershipWorkflowSelect
                    {...control}
                    name="workflowVersionId"
                    value={draft.workflowVersionId}
                    disabled={!canWrite || saving}
                    onChange={(workflowVersionId) => setDraft({ ...draft, workflowVersionId })}
                  />
                )}
              </Field>
              <Checkbox
                name="active"
                label="Available for new applications"
                checked={draft.active}
                onChange={(event) => setDraft({ ...draft, active: event.currentTarget.checked })}
              />
              <div class="pk-grid pk-grid--tight">
                <Field label="Label" required {...form.of("label")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="label"
                      maxlength={MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH}
                      value={draft.label}
                      onInput={(event) => setDraft({ ...draft, label: (event.target as HTMLInputElement).value })}
                    />
                  )}
                </Field>
                <Field
                  label="Display order"
                  help="Where the category sits in every list of categories; lower comes first."
                  {...form.of("displayOrder")}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name="displayOrder"
                      type="number"
                      min={0}
                      value={draft.displayOrder}
                      onInput={(event) =>
                        setDraft({ ...draft, displayOrder: Number((event.target as HTMLInputElement).value) })
                      }
                    />
                  )}
                </Field>
              </div>
              <Field
                label="Description"
                help="Shown to applicants choosing a category on the join form."
                {...form.of("description")}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="description"
                    rows={3}
                    maxlength={MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH}
                    value={draft.description ?? ""}
                    onInput={(event) => {
                      const value = (event.target as HTMLTextAreaElement).value;
                      setDraft({ ...draft, description: value || null });
                    }}
                  />
                )}
              </Field>
              <Checkbox
                name="isVoting"
                checked={draft.isVoting}
                onChange={(event) => setDraft({ ...draft, isVoting: (event.target as HTMLInputElement).checked })}
                label="This category has consortium and group voting rights"
              />
              <p class="pk-warning-note">
                Caution: voting-right changes take effect immediately for consultation concerns and open ballots.
              </p>
            </fieldset>
            <ErrorAlert error={error} />
            {canWrite && (
              <div class="pk-cluster pk-cluster--end">
                <Button type="button" variant="secondary" disabled={saving} onClick={() => navigate(CATEGORIES_PATH)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={saving} aria-busy={saving}>
                  {saving ? "Saving…" : category ? `Save category ${category.code}` : "Create category"}
                </Button>
              </div>
            )}
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
