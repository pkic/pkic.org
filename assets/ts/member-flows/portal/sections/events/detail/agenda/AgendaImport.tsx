import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaImportSchema,
  agendaImportResponseSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import type { z } from "zod";
type ImportBody = z.infer<typeof agendaImportSchema>;
export function AgendaImport({
  snapshot,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [source, setSource] = useState<ImportBody["source"]>("accepted_proposals");
  const [occurrences, setOccurrences] = useState<ImportBody["occurrences"]>([]);
  const [preview, setPreview] = useState<{ imported: number; skipped: number; revision: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(agendaImportSchema, {
    expectedRevision: snapshot.revision,
    source,
    dryRun: true,
    occurrences,
  });
  async function load(file: File | undefined) {
    setPreview(null);
    if (!file) return;
    try {
      setOccurrences(agendaImportSchema.shape.occurrences.parse(JSON.parse(await file.text())));
      setError("");
    } catch (e) {
      setError(form.refuse(e));
    }
  }
  async function run(apply: boolean) {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      const result = await postJson(
        `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/imports`,
        { ...checked.data, dryRun: !apply },
        agendaImportResponseSchema,
      );
      if (apply) {
        onSaved(result.agenda);
        onClose();
      } else {
        setPreview({ ...result, revision: snapshot.revision });
      }
      setError("");
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Import sessions" />
      <PanelBody>
        <p>
          Preview an import before applying it. Existing imported sessions are preserved; repeated imports skip their
          stable source keys.
        </p>
        {error && <ErrorAlert error={error} />}
        <form
          ref={focus}
          noValidate
          {...form.handlers}
          class="pk-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(false);
          }}
        >
          <Field label="Import source" {...form.of("source")}>
            {(control) => (
              <Select
                {...control}
                name="source"
                value={source}
                onChange={(event) => {
                  setSource(agendaImportSchema.shape.source.parse(event.currentTarget.value));
                  setPreview(null);
                }}
              >
                {agendaImportSchema.shape.source.options.map((value) => (
                  <option value={value}>
                    {value === "accepted_proposals" ? "Accepted proposals" : "Historical agenda file"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {source === "legacy" && (
            <Field
              label="Historical agenda JSON"
              help="Use the migration file with stable source keys and mapped speaker and location IDs."
              {...form.of("occurrences")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="occurrences"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void load(event.currentTarget.files?.[0])}
                />
              )}
            </Field>
          )}
          {preview && (
            <p role="status">
              {preview.imported} sessions ready to import · {preview.skipped} already imported.
            </p>
          )}
          <div class="pk-cluster pk-cluster--end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              Preview import
            </Button>
            <Button
              variant="primary"
              disabled={busy || !preview || preview.revision !== snapshot.revision || preview.imported === 0}
              onClick={() => void run(true)}
            >
              Apply import
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
