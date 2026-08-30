/** Loading indicator; give it a label so the wait names what is loading. */
export function Spinner({ label }: { label?: string } = {}) {
  return (
    <div class="text-center py-4">
      <div class="spinner-border spinner-border-sm text-secondary" role="status">
        <span class="visually-hidden">{label ?? "Loading…"}</span>
      </div>
      {label && <p class="small text-muted mt-2 mb-0">{label}</p>}
    </div>
  );
}
