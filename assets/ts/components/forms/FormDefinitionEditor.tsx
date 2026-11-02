import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  FORM_PURPOSES,
  FORM_STATUSES,
  formDefinitionCreateSchema,
  formDefinitionUpdateSchema,
  type FormDefinitionCreateInput,
  type FormDefinitionUpdateInput,
  type FormFieldDefinition,
  type FormPurpose,
  type FormStatus,
} from "../../../shared/schemas/forms";
import { emptyFieldDraft, fieldDraftToInput, fieldToDraft, type FieldDraft, type FieldType } from "./form-field-draft";
import { ClosedQuestion, OpenQuestion } from "./FormQuestionCard";
import { FormQuestionPalette } from "./FormQuestionPalette";
import { FormRespondentPreview } from "./FormRespondentPreview";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { TabList } from "../../ui/TabList";
import { Select, TextInput } from "../../ui/TextControl";
// `pk-mono` is a Content.css class, and component CSS ships in lazy chunks —
// without this import the key inputs render in the body face.
import "../../ui/Content.css";
import "./FormBuilder.css";
import { slugify } from "../../../shared/slug";
import { useContractForm } from "../../hooks/useContractForm";
import { ApiClientError } from "../../shared/api-client";

export interface EditableFormDetail {
  form: {
    key: string;
    purpose: FormPurpose;
    title: string;
    description: string | null;
    status: FormStatus;
  };
  fields: FormFieldDefinition[];
}

interface FormDraft {
  key: string;
  purpose: FormPurpose;
  title: string;
  description: string;
  status: FormStatus;
  fields: FieldDraft[];
}

/**
 * The key a title implies.
 *
 * A form's key is the stable name it carries in URLs and the API, and an
 * author who has just typed a title has already said what it should be. It is
 * derived until they change it, at which point their own value stands.
 */
function keyFromTitle(title: string): string {
  return slugify(title, { maxLength: 60 });
}

/** What each status means for a respondent, rather than its bare name. */
const STATUS_LABELS: Record<FormStatus, string> = {
  active: "Active — accepting responses",
  inactive: "Inactive — not accepting responses",
  archived: "Archived",
};

function detailToDraft(detail: EditableFormDetail | null, purposes: readonly FormPurpose[]): FormDraft {
  if (!detail) {
    return {
      key: "",
      purpose: purposes[0] ?? "survey",
      title: "",
      description: "",
      status: "active",
      fields: [emptyFieldDraft(0)],
    };
  }

  return {
    key: detail.form.key,
    purpose: detail.form.purpose,
    title: detail.form.title,
    description: detail.form.description ?? "",
    status: detail.form.status,
    fields: detail.fields.length ? detail.fields.map(fieldToDraft) : [emptyFieldDraft(0)],
  };
}

/**
 * The draft as the form contract reads it. A question with neither a key nor
 * a label is an empty card and is left out, so `positions` maps each question
 * the contract sees back to the card it came from.
 */
function draftBody(draft: FormDraft, mode: "create" | "edit") {
  const positions = draft.fields.flatMap((field, index) => (field.key.trim() || field.label.trim() ? [index] : []));
  const fields = positions.map((index, position) => fieldDraftToInput(draft.fields[index], (position + 1) * 10));
  const payload = {
    ...(mode === "create" ? { key: draft.key.trim(), purpose: draft.purpose } : {}),
    title: draft.title.trim(),
    description: draft.description.trim() || (mode === "create" ? undefined : null),
    status: draft.status,
    fields,
  };
  return { payload, positions };
}

export function FormDefinitionEditor({
  mode,
  detail,
  purposes = FORM_PURPOSES,
  onSave,
  onSaved,
  onCancel,
  onError,
}: {
  mode: "create" | "edit";
  detail: EditableFormDetail | null;
  purposes?: readonly FormPurpose[];
  onSave: (payload: FormDefinitionCreateInput | FormDefinitionUpdateInput) => Promise<string>;
  onSaved: (key: string) => void;
  onCancel: () => void;
  onError?: (message: string) => void;
}) {
  const [draft, setDraft] = useState<FormDraft>(() => detailToDraft(detail, purposes));
  const body = draftBody(draft, mode);
  const schema = mode === "create" ? formDefinitionCreateSchema : formDefinitionUpdateSchema;
  const form = useContractForm<typeof schema>(schema, body.payload);
  /** A question's parts as the form contract judges them, addressed from the card's own index. */
  const questionPath = (index: number) => {
    const position = body.positions.indexOf(index);
    return position < 0 ? null : `fields.${String(position)}`;
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A new form opens on its first question; an existing one opens closed, so
  // the author sees the whole form before editing any one part of it.
  const [openIndex, setOpenIndex] = useState(mode === "create" ? 0 : -1);
  const [tab, setTab] = useHashQueryParam("editorView", "build");
  // Until an author opens the key, the title is what names the form.
  const [keyOpen, setKeyOpen] = useState(false);
  const draftSource = `${mode}:${detail?.form.key ?? ""}`;
  const previousDraftSource = useRef(draftSource);

  useEffect(() => {
    // The initial state already reflects the initial props. Avoid a redundant
    // post-paint reset that can erase input typed immediately after mounting.
    if (previousDraftSource.current === draftSource) return;
    previousDraftSource.current = draftSource;
    setDraft(detailToDraft(detail, purposes));
    setError("");
  }, [detail, draftSource, purposes]);

  function updateField(index: number, patch: Partial<FieldDraft>) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    }));
  }

  function moveField(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const fields = [...current.fields];
      const target = index + direction;
      if (target < 0 || target >= fields.length) return current;
      [fields[index], fields[target]] = [fields[target], fields[index]];
      return { ...current, fields };
    });
  }

  function addField(fieldType: FieldType) {
    setDraft((current) => {
      const fields = [...current.fields, { ...emptyFieldDraft(current.fields.length), fieldType }];
      setOpenIndex(fields.length - 1);
      return { ...current, fields };
    });
  }

  function duplicateField(index: number) {
    setDraft((current) => {
      const source = current.fields[index];
      const fields = [...current.fields];
      // A duplicate cannot carry the original's key: two fields sharing one key
      // is exactly what the contract refuses.
      fields.splice(index + 1, 0, { ...source, key: "" });
      setOpenIndex(index + 1);
      return { ...current, fields };
    });
  }

  function removeField(index: number) {
    setOpenIndex(-1);
    setDraft((current) => ({ ...current, fields: current.fields.filter((_, i) => i !== index) }));
  }

  async function save(e: Event) {
    e.preventDefault();
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      // The first refused question opens, so its refusal is in view.
      const refused = schema.safeParse(body.payload);
      const first = refused.success ? undefined : refused.error.issues.find((issue) => issue.path[0] === "fields");
      if (first) setOpenIndex(body.positions[Number(first.path[1])] ?? -1);
      const formWide = ["key", "title", "description", "status", "purpose"].flatMap((name) => form.errorsWithin(name));
      const message = [checked.formMessage, ...formWide].filter(Boolean).join(" ");
      setError(message);
      if (message) onError?.(message);
      return;
    }
    setSaving(true);
    try {
      const key = await onSave(checked.data);
      onSaved(key);
    } catch (err) {
      const message = err instanceof ApiClientError ? form.refuse(err) : (err as Error).message;
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  }

  const questions = draft.fields;
  const preview = tab === "preview";

  return (
    <form class="pk pk-stack" onSubmit={(e) => void save(e)} noValidate {...form.handlers}>
      <div class="pk-tabs-rule">
        <TabList
          label="Form editor"
          idPrefix="form-editor"
          activeId={tab}
          onSelect={(id) => setTab(id as "build" | "preview")}
          items={[
            { id: "build", label: "Build" },
            { id: "preview", label: "Preview" },
          ]}
        />
      </div>

      {preview ? (
        <FormRespondentPreview title={draft.title} description={draft.description} fields={questions} />
      ) : (
        <div class="pk-formbuild">
          <div class="pk-stack">
            {/*
             * The form's own card. Title and description are edited where they
             * are read rather than in labeled boxes above the questions, which
             * is what makes the column read as the form it is building.
             */}
            <Panel aria-label="Form details">
              <div class="pk-formcard__rule" aria-hidden="true" />
              <PanelBody class="pk-stack pk-stack--tight">
                <input
                  class="pk-formtitle pk-formtitle--name"
                  value={draft.title}
                  aria-label="Form title"
                  placeholder="Untitled form"
                  required
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      title: value,
                      // An untouched key follows the title; an author's own key
                      // is never overwritten by what they type above it.
                      key: mode === "create" && !keyOpen ? keyFromTitle(value) : current.key,
                    }));
                  }}
                />
                <textarea
                  class="pk-formtitle pk-formtitle--desc"
                  rows={2}
                  value={draft.description}
                  aria-label="Form description"
                  placeholder="Add a short description respondents read before they start…"
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    setDraft((current) => ({ ...current, description: value }));
                  }}
                />
                <div class="pk-cluster">
                  <span class="pk-small pk-muted">Key</span>
                  {mode === "edit" || !keyOpen ? (
                    <>
                      <code class="pk-mono pk-small">{draft.key.trim() || "untitled-form"}</code>
                      {mode === "create" && (
                        <>
                          <span class="pk-small pk-muted">generated from the title</span>
                          <button type="button" class="pk-linkish pk-small" onClick={() => setKeyOpen(true)}>
                            Change
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <TextInput
                      class="pk-mono"
                      value={draft.key}
                      required
                      pattern="[a-z][a-z0-9-]*"
                      aria-label="Form key"
                      onInput={(e) => {
                        const value = e.currentTarget.value;
                        setDraft((current) => ({ ...current, key: value }));
                      }}
                    />
                  )}
                </div>
              </PanelBody>
            </Panel>

            {questions.map((field, index) => {
              const position = String(index + 1);
              const path = questionPath(index);
              return index === openIndex ? (
                <OpenQuestion
                  key={index}
                  field={field}
                  index={index}
                  position={position}
                  last={index === questions.length - 1}
                  onlyField={questions.length === 1}
                  update={(patch) => updateField(index, patch)}
                  onClose={() => setOpenIndex(-1)}
                  onMove={(direction) => moveField(index, direction)}
                  onDuplicate={() => duplicateField(index)}
                  onRemove={() => removeField(index)}
                  presentationOf={path ? (part) => form.ofGroup(`${path}.${part}`) : undefined}
                />
              ) : (
                <ClosedQuestion
                  key={index}
                  field={field}
                  position={position}
                  problem={path ? form.errorsWithin(path)[0] : undefined}
                  onOpen={() => setOpenIndex(index)}
                />
              );
            })}

            <FormQuestionPalette onAdd={addField} />
          </div>

          <div class="pk-formbuild__rail pk-stack">
            <Panel aria-label="Form settings">
              <PanelHeader title="Form settings" />
              <PanelBody class="pk-stack pk-stack--tight">
                <Field label="Purpose">
                  {(control) => (
                    <Select
                      {...control}
                      value={draft.purpose}
                      disabled={mode === "edit"}
                      onChange={(e) => {
                        const value = e.currentTarget.value as FormPurpose;
                        setDraft((current) => ({ ...current, purpose: value }));
                      }}
                    >
                      {purposes.map((purpose) => (
                        <option key={purpose} value={purpose}>
                          {purpose.replace(/_/g, " ")}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Status">
                  {(control) => (
                    <Select
                      {...control}
                      value={draft.status}
                      onChange={(e) => {
                        const value = e.currentTarget.value as FormStatus;
                        setDraft((current) => ({ ...current, status: value }));
                      }}
                    >
                      {FORM_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </PanelBody>
            </Panel>
          </div>
        </div>
      )}

      {/* The save failure is announced where it happened rather than left as
          quiet red text beside the button. */}
      {error && <Alert tone="danger">{error}</Alert>}

      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? "Saving..." : mode === "create" ? "Create form" : "Save form"}
        </Button>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
