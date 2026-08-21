export function MagicLinkSubmitButton({ submitting }: { submitting: boolean }) {
  return (
    <button type="submit" class="btn btn-success w-100" disabled={submitting}>
      {submitting ? "Sending…" : "Send sign-in link"}
    </button>
  );
}

export function SignInError({ error, includePrefix = true }: { error: string | null; includePrefix?: boolean }) {
  if (!error) return null;
  return (
    <div class="alert alert-danger mt-3">
      ✕ {includePrefix ? "Sign-in failed: " : ""}
      {error}
    </div>
  );
}
