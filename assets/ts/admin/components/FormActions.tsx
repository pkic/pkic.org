export function FormActions({
  submitLabel,
  busyLabel = submitLabel,
  busy,
  onCancel,
  status,
  submitVariant = "success",
  statusVariant = "muted",
}: {
  submitLabel: string;
  busyLabel?: string;
  busy: boolean;
  onCancel: () => void;
  status?: string;
  submitVariant?: "primary" | "success";
  statusVariant?: "muted" | "danger";
}) {
  return (
    <div class="d-flex gap-2 align-items-center">
      <button type="submit" class={`btn btn-sm btn-${submitVariant}`} disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </button>
      <button type="button" class="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      {status && <span class={`small text-${statusVariant}`}>{status}</span>}
    </div>
  );
}
