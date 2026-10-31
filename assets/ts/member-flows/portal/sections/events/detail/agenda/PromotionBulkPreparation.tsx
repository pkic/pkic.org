import { useDialogQueryState } from "../../../../../../hooks/useDialogQueryState";
import { useEffect, useState } from "preact/hooks";
import {
  promotionBatchCreateSchema,
  promotionBatchSchema,
  type PromotionBatch,
} from "../../../../../../../shared/schemas/event-promotion-batches";
import { promotionFormatSchema } from "../../../../../../../shared/schemas/event-promotion-kit";
import type { z } from "zod";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson, getJson } from "../../../../../../shared/api-client";
import { IconPlus } from "../../../../../../components/icons";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Checkbox } from "../../../../../../ui/Checkbox";
const formatLabels = {
  carousel: "Carousel PDF",
  landscape: "Landscape images",
  square: "Square images",
  portrait: "Portrait images",
  panel: "Panel images",
} as const;
export function PromotionBulkPreparation({
  slug,
  publishedRevision,
}: {
  slug: string;
  publishedRevision: number | null;
}) {
  const [batchId, setBatchId] = useHashQueryParam("promotionBatch", "");
  const [creating, showCreating, closeCreating] = useDialogQueryState("promotionBatchCreate");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [requestId, setRequestId] = useState(crypto.randomUUID());
  const [formats, setFormats] = useState<z.infer<typeof promotionFormatSchema>[]>([...promotionFormatSchema.options]);
  const [batch, setBatch] = useState<PromotionBatch | null>(null);
  const base = `/api/v1/events/${encodeURIComponent(slug)}/promotion/batches`;
  const form = useContractForm(promotionBatchCreateSchema, {
    requestId,
    publishedRevision: publishedRevision ?? 0,
    formats,
  });
  async function close() {
    if (creating) await closeCreating();
    if (batchId) setBatchId("");
    setError("");
  }
  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const value = await getJson(`${base}/${encodeURIComponent(batchId)}`, promotionBatchSchema);
        if (cancelled) return;
        setBatch(value);
        setError("");
        if (["preparing", "rendering"].includes(value.status)) timer = setTimeout(() => void refresh(), 3000);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load bulk preparation progress.");
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [base, batchId]);
  async function start() {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    try {
      const value = await postJson(base, checked.data, promotionBatchSchema);
      setBatch(value);
      await closeCreating();
      setBatchId(value.id);
      setError("");
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        onClick={() => {
          setRequestId(crypto.randomUUID());
          setBatch(null);
          showCreating();
          setError("");
        }}
        disabled={!publishedRevision}
      >
        <IconPlus />
        Prepare kits for all speakers
      </Button>
      {(creating || batchId) && (
        <Dialog
          open
          title="Prepare speaker promotion kits"
          closeLabel="Close bulk promotion preparation"
          description="Prepare a personal kit for each speaker in every published session. Each kit keeps its owner’s referral link and adjustments. Nothing is sent to speakers."
          confirmLabel={batchId ? "Done" : "Prepare all speaker kits"}
          confirmDisabled={busy}
          onConfirm={() => (batchId ? close() : void start())}
          onCancel={close}
        >
          {creating && (
            <form
              noValidate
              {...form.handlers}
              class="pk-form"
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <Field label="Formats" {...form.of("formats")}>
                {() => (
                  <div class="pk-stack">
                    {promotionFormatSchema.options.map((format) => (
                      <Checkbox
                        key={format}
                        label={formatLabels[format]}
                        checked={formats.includes(format)}
                        onChange={(event) =>
                          setFormats(
                            event.currentTarget.checked
                              ? [...formats, format]
                              : formats.filter((item) => item !== format),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </Field>
            </form>
          )}
          {batch && (
            <div class="pk-stack" aria-live="polite">
              <p>
                {batch.totalKits === 0
                  ? "No published speaker sessions are available for this batch."
                  : batch.status === "obsolete"
                    ? "The published agenda changed. Start a new batch for the current agenda."
                    : batch.status === "complete"
                      ? "All speaker kits are ready."
                      : batch.status === "needs_attention"
                        ? "Preparation finished with some failures. Start a new batch to retry; current ready files are reused."
                        : "Preparation continues in the background. You can close this dialog."}
              </p>
              <p>
                {formatNumber(batch.readyKits)} ready · {formatNumber(batch.pendingKits)} pending ·{" "}
                {formatNumber(batch.failedKits)} failed · {formatNumber(batch.totalKits)} total kits
              </p>
            </div>
          )}
          {error && <ErrorAlert error={error} />}
        </Dialog>
      )}
    </>
  );
}
