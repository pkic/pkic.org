import { useState } from "preact/hooks";
import { useContractForm } from "../../../../../hooks/useContractForm";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { patchJson } from "../../../../../shared/api-client";
import { Dialog } from "../../../../../ui/Dialog";
import { Field } from "../../../../../ui/Field";
import { Select, TextInput } from "../../../../../ui/TextControl";
import { statusLabel } from "../../../../../components/Badge";
import { toast } from "../../../ui";
import {
  SPONSORSHIP_PIPELINE_STAGES,
  sponsorshipResponseSchema,
  sponsorshipStageUpdateSchema,
  type Sponsorship,
  type SponsorshipPipelineStage,
} from "../../../../../../shared/schemas/sponsorship-management";
import {
  SPONSORSHIP_END_REASONS,
  SPONSORSHIP_END_REASON_LABELS,
  type SponsorshipEndReason,
} from "../../../../../../shared/sponsorship-logo-policy";

/** The existing stage dialog uses the same request contract as its route. */
export function SponsorshipStageDialog({
  sponsorship,
  title,
  onSaved,
  onCancel,
}: {
  sponsorship: Sponsorship;
  title: string;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<SponsorshipPipelineStage>("contacted");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<SponsorshipEndReason>("termination");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ending = stage === "lapsed" || stage === "not_proceeding";
  const form = useContractForm(sponsorshipStageUpdateSchema, {
    toStage: stage,
    note: note.trim() || null,
    ...(ending ? { endReason: reason } : {}),
  });
  async function save() {
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    setBusy(true);
    setError(null);
    try {
      await patchJson(
        `/api/v1/sponsors/${encodeURIComponent(sponsorship.id)}/stage`,
        checked.data,
        sponsorshipResponseSchema,
      );
      toast(`Stage moved to ${statusLabel(stage)}`, "success");
      await onSaved();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title="Move stage"
      description={`${title} stands at ${statusLabel(sponsorship.pipelineStage)}. The move and its note are written to the pipeline history.`}
      confirmLabel={busy ? "Moving…" : "Move stage"}
      confirmDisabled={busy || !form.valid}
      onConfirm={() => void save()}
      onCancel={onCancel}
    >
      <form
        aria-label="Move sponsorship stage"
        noValidate
        class="pk-stack pk-stack--snug"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {error && <ErrorAlert error={new Error(error)} />}
        <Field label="Move to stage" {...form.of("toStage")}>
          {(control) => (
            <Select
              {...control}
              name="toStage"
              value={stage}
              disabled={busy}
              onChange={(event) => {
                const next = event.currentTarget.value as SponsorshipPipelineStage;
                setStage(next);
                if (next === "not_proceeding" && reason === "ordinary_expiry") setReason("termination");
              }}
            >
              {SPONSORSHIP_PIPELINE_STAGES.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {ending && (
          <Field
            label="End reason"
            required
            {...form.of("endReason")}
            help="Only ordinary expiry keeps a qualifying consortium sponsor's logo for 90 days after its renewal date. Access ends at expiry."
          >
            {(control) => (
              <Select
                {...control}
                name="endReason"
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.currentTarget.value as SponsorshipEndReason)}
              >
                {SPONSORSHIP_END_REASONS.filter((value) => value !== "ordinary_expiry" || stage === "lapsed").map(
                  (value) => (
                    <option key={value} value={value}>
                      {SPONSORSHIP_END_REASON_LABELS[value]}
                    </option>
                  ),
                )}
              </Select>
            )}
          </Field>
        )}
        <Field label="Note (optional)" {...form.of("note")}>
          {(control) => (
            <TextInput
              {...control}
              name="note"
              value={note}
              disabled={busy}
              onInput={(event) => setNote(event.currentTarget.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
