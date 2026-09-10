/**
 * Membership categories — the catalog every membership grant, the join flow
 * and the application form draw on.
 *
 * Its own page rather than the bottom half of a "Membership Settings" screen
 * (#40). It is also the page issue #16 was really about, so the paragraph
 * explaining where a new category comes from is the first thing on it rather
 * than something a reader has to scroll two panels to find.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH,
  MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH,
  membershipCategoryCatalogResponseSchema,
  membershipCategoryResponseSchema,
  membershipCategoryUpdateSchema,
  type MembershipCategoryCatalogEntry,
} from "../../../../../shared/schemas/membership-categories";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Badge } from "../../../../ui/Badge";
import { EditActions } from "../../../../ui/EditActions";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { useContractForm } from "../../../../hooks/useContractForm";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Textarea, TextInput } from "../../../../ui/TextControl";
import { getJson, patchJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

const CATEGORIES_API = "/api/v1/membership/categories";

function CategoryEditor({
  category,
  canWrite,
  onSaved,
}: {
  category: MembershipCategoryCatalogEntry;
  canWrite: boolean;
  onSaved: (category: MembershipCategoryCatalogEntry) => void;
}) {
  const [draft, setDraft] = useState(category);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(membershipCategoryUpdateSchema, {
    expectedRevision: category.revision,
    label: draft.label,
    description: draft.description,
    displayOrder: draft.displayOrder,
    isVoting: draft.isVoting,
  });
  function reset() {
    setDraft(category);
    form.reset();
    setError("");
  }

  useEffect(() => setDraft(category), [category]);

  async function save(event: Event) {
    event.preventDefault();
    if (!canWrite || !editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setError("");
    setSaving(true);
    try {
      const response = await patchJson(
        `${CATEGORIES_API}/${encodeURIComponent(category.code)}`,
        checked.data,
        membershipCategoryResponseSchema,
      );
      setDraft(response.category);
      onSaved(response.category);
      setEditing(false);
      toast(`Category ${category.code} saved`, "success");
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate {...form.handlers} onSubmit={save} autocomplete="off">
      <Panel aria-label={`Category ${category.code}`}>
        <PanelHeader title={`${category.label} (${category.code})`} headingLevel={3}>
          <Badge tone="neutral">{category.isIndividual ? "Individual" : "Organization"}</Badge>
          <Badge tone={category.isVoting ? "ok" : "neutral"}>{category.isVoting ? "Voting" : "Non-voting"}</Badge>
          {canWrite && (
            <EditActions
              label={`Category ${category.code} actions`}
              editing={editing}
              saving={saving}
              saveLabel={`Save category ${category.code}`}
              onEdit={() => {
                reset();
                setEditing(true);
              }}
              onCancel={() => {
                reset();
                setEditing(false);
              }}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          {editing ? (
            <>
              <div class="pk-grid">
                <Field label="Label" {...form.of("label")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="label"
                      maxlength={MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH}
                      value={draft.label}
                      disabled={!canWrite || saving}
                      onInput={(event) => setDraft({ ...draft, label: (event.target as HTMLInputElement).value })}
                    />
                  )}
                </Field>
                <Field label="Display order" {...form.of("displayOrder")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="displayOrder"
                      type="number"
                      min={0}
                      value={draft.displayOrder}
                      disabled={!canWrite || saving}
                      onInput={(event) =>
                        setDraft({ ...draft, displayOrder: Number((event.target as HTMLInputElement).value) })
                      }
                    />
                  )}
                </Field>
              </div>
              <Field label="Description" {...form.of("description")}>
                {(control) => (
                  <Textarea
                    {...control}
                    name="description"
                    rows={2}
                    maxlength={MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH}
                    value={draft.description ?? ""}
                    disabled={!canWrite || saving}
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
                disabled={!canWrite || saving}
                onChange={(event) => setDraft({ ...draft, isVoting: (event.target as HTMLInputElement).checked })}
                label="This category has consortium and group voting rights"
              />
            </>
          ) : (
            <DescriptionList
              items={[
                { term: "Description", value: category.description },
                { term: "Display order", value: category.displayOrder },
              ]}
            />
          )}
          <ErrorAlert error={error} />
        </PanelBody>
      </Panel>
    </form>
  );
}

export function MembershipCategories({ canWrite }: { canWrite: boolean }) {
  // The rows are edited in place, so the page owns them rather than reading
  // them out of a fetch hook it would then have to keep writing back into.
  const [categories, setCategories] = useState<MembershipCategoryCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(CATEGORIES_API, membershipCategoryCatalogResponseSchema);
      setCategories(response.categories);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  return (
    <div class="pk pk-stack">
      <PageHeader title="Membership categories" />
      <div class="pk-stack pk-stack--tight">
        {/*
          Issue #16 asked how a new category is added, and "cannot be changed
          here" did not answer it: it says where not to look without saying
          whether the thing is possible. What the categories are is a bylaw
          question, and the code, the individual/organization split and the
          eligibility that follows from them are wired through the
          application form, the join flow and every membership grant — so a
          new one arrives with a governance decision and a release, not from
          this page. Everything a category says about itself is editable
          below, which is the part staff genuinely own.
        */}
        <p class="pk-small">
          Which categories exist follows from the bylaws: the code and whether it is held by an organization or an
          individual are structural, and a new category is a governance decision that ships with a release rather than
          something added here. What each one is called, how it is described, where it sits in the list, and whether it
          carries voting rights are set below.
        </p>
        <p class="pk-warning-note">
          Caution: voting-right changes take effect immediately for consultation concerns and open ballots.
        </p>
      </div>
      {loading ? (
        <Spinner label="Loading membership categories…" />
      ) : error ? (
        <ErrorAlert error={error} />
      ) : (
        <div class="pk-stack">
          {categories.map((category) => (
            <CategoryEditor
              key={category.code}
              category={category}
              canWrite={canWrite}
              onSaved={(updated) =>
                setCategories((current) =>
                  current
                    .map((entry) => (entry.code === updated.code ? updated : entry))
                    .sort(
                      (left, right) => left.displayOrder - right.displayOrder || left.code.localeCompare(right.code),
                    ),
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
