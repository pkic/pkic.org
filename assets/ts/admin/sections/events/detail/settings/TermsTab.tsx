import { useState } from "preact/hooks";
import { api } from "../../../../api";
import { adminEventTermsResponseSchema } from "../../../../../../shared/schemas/admin-events";
import type { AdminEventTerm } from "../../../../types";
import { useAdminEditorResource } from "../../../../hooks/useAdminEditorResource";
import { saveAdminEditor } from "../../../../actions";
import { AdminSettingsEditor } from "../../../../components/AdminSettingsEditor";

interface TermState {
  termKey: string;
  version: string;
  required: boolean;
  contentRef: string;
  displayText: string;
  helpText: string;
}

function emptyTerm(): TermState {
  return { termKey: "", version: "1.0", required: true, contentRef: "", displayText: "", helpText: "" };
}

function termFromRow(term: AdminEventTerm): TermState {
  return {
    termKey: term.term_key,
    version: term.version,
    required: Boolean(term.required),
    contentRef: term.content_ref ?? "",
    displayText: term.display_text ?? "",
    helpText: term.help_text ?? "",
  };
}

function TermRow({
  term,
  onChange,
  onRemove,
}: {
  term: TermState;
  onChange: (term: TermState) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<TermState>) => onChange({ ...term, ...patch });
  return (
    <div class="card border mb-2">
      <div class="card-body py-2 px-3">
        <div class="row g-2 mb-2">
          <div class="col-md-3">
            <label class="form-label small mb-1">Key</label>
            <input
              class="form-control form-control-sm mono"
              value={term.termKey}
              onInput={(event) => update({ termKey: (event.target as HTMLInputElement).value })}
              placeholder="terms-of-service"
            />
          </div>
          <div class="col-md-2">
            <label class="form-label small mb-1">Version</label>
            <input
              class="form-control form-control-sm mono"
              value={term.version}
              onInput={(event) => update({ version: (event.target as HTMLInputElement).value })}
              placeholder="1.0"
            />
          </div>
          <div class="col-md-5">
            <label class="form-label small mb-1">Link URL</label>
            <input
              class="form-control form-control-sm"
              type="url"
              value={term.contentRef}
              onInput={(event) => update({ contentRef: (event.target as HTMLInputElement).value })}
              placeholder="https://..."
            />
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <div class="form-check">
              <input
                class="form-check-input"
                type="checkbox"
                checked={term.required}
                onChange={(event) => update({ required: (event.target as HTMLInputElement).checked })}
                id={`req-${term.termKey}`}
              />
              <label class="form-check-label small" for={`req-${term.termKey}`}>
                Req
              </label>
            </div>
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <button type="button" class="btn btn-sm btn-outline-danger" onClick={onRemove}>
              ✕
            </button>
          </div>
        </div>
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label small mb-1">Display text</label>
            <input
              class="form-control form-control-sm"
              value={term.displayText}
              onInput={(event) => update({ displayText: (event.target as HTMLInputElement).value })}
              placeholder="I agree to the Terms of Service"
            />
          </div>
          <div class="col-md-6">
            <label class="form-label small mb-1">Help text</label>
            <input
              class="form-control form-control-sm"
              value={term.helpText}
              onInput={(event) => update({ helpText: (event.target as HTMLInputElement).value })}
              placeholder="Optional help text shown below"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TermsGroup({
  title,
  terms,
  onChange,
  addLabel,
}: {
  title?: string;
  terms: TermState[];
  onChange: (terms: TermState[]) => void;
  addLabel: string;
}) {
  return (
    <>
      {title && <h6 class="small fw-bold text-uppercase text-muted mb-2">{title}</h6>}
      {terms.map((term, index) => (
        <TermRow
          key={`${term.termKey}-${index}`}
          term={term}
          onChange={(updated) =>
            onChange(terms.map((current, currentIndex) => (currentIndex === index ? updated : current)))
          }
          onRemove={() => onChange(terms.filter((_, currentIndex) => currentIndex !== index))}
        />
      ))}
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary mb-4"
        onClick={() => onChange([...terms, emptyTerm()])}
      >
        + {addLabel}
      </button>
    </>
  );
}

export function TermsTab({ slug }: { slug: string }) {
  const termsResource = useAdminEditorResource(
    async () => {
      const data = await api(`/api/v1/admin/events/${slug}/terms`, adminEventTermsResponseSchema);
      return {
        attendee: (data.terms?.attendee ?? []).map(termFromRow),
        speaker: (data.terms?.speaker ?? []).map(termFromRow),
        presentation: (data.terms?.presentation ?? []).map(termFromRow),
      };
    },
    [slug],
    { attendee: [], speaker: [], presentation: [] } as Record<"attendee" | "speaker" | "presentation", TermState[]>,
  );
  const { value: terms, setValue: setTerms, loading, error, reload } = termsResource;
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const { attendee, speaker, presentation } = terms;
  const updateTerms = (kind: keyof typeof terms, value: TermState[]) =>
    setTerms((current) => ({ ...current, [kind]: value }));

  async function handleSave() {
    const toPayload = (items: TermState[]) =>
      items
        .filter((term) => term.termKey.trim() && term.displayText.trim())
        .map((term) => ({
          termKey: term.termKey.trim(),
          version: term.version.trim() || "1.0",
          required: term.required,
          contentRef: term.contentRef.trim() || undefined,
          displayText: term.displayText.trim(),
          helpText: term.helpText.trim() || undefined,
        }));
    await saveAdminEditor({
      setSaving,
      setStatus: setSaveStatus,
      request: () =>
        api(`/api/v1/admin/events/${slug}/terms`, adminEventTermsResponseSchema, {
          method: "PUT",
          body: JSON.stringify({
            attendee: toPayload(attendee),
            speaker: toPayload(speaker),
            presentation: toPayload(presentation),
          }),
        }),
      successMessage: "Terms updated",
      reload,
    });
  }

  return (
    <AdminSettingsEditor
      loading={loading}
      error={error}
      description="Manage terms & conditions shown during registration"
      actions={
        <>
          <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>
            ↺ Refresh
          </button>
          <button class="btn btn-sm btn-primary" onClick={() => void handleSave()} disabled={saving}>
            Save Terms
          </button>
        </>
      }
    >
      {saveStatus && (
        <div class={`small mb-2 ${saveStatus.startsWith("✓") ? "text-success" : "text-warning"}`}>{saveStatus}</div>
      )}

      <TermsGroup
        title="Attendee Terms"
        terms={attendee}
        onChange={(value) => updateTerms("attendee", value)}
        addLabel="Add attendee term"
      />
      <TermsGroup
        title="Speaker Terms"
        terms={speaker}
        onChange={(value) => updateTerms("speaker", value)}
        addLabel="Add speaker term"
      />

      <h6 class="small fw-bold text-uppercase text-muted mb-2">Presentation Upload Terms</h6>
      <p class="small text-muted mb-2">
        Shown as a disclaimer before speakers upload their presentation. Leave empty to use the built-in defaults.
      </p>
      <TermsGroup
        terms={presentation}
        onChange={(value) => updateTerms("presentation", value)}
        addLabel="Add presentation term"
      />
    </AdminSettingsEditor>
  );
}
