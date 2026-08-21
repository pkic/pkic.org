export function VerifyingOverlay({ message = "Verifying your sign-in link…" }: { message?: string }) {
  return (
    <div class="d-flex flex-column align-items-center py-5">
      <div class="spinner-border text-success mb-3" role="status"></div>
      <p class="text-muted mb-0">{message}</p>
    </div>
  );
}
